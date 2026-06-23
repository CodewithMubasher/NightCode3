import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".db", "cache"])

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".css", ".html", ".yml", ".yaml", ".toml",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".sh", ".bash", ".ps1", ".bat",
  ".sql", ".graphql", ".prisma",
  ".env", ".txt", ".xml", ".svg",
])

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

interface Match {
  file: string
  line: number
  content: string
}

function walkDir(dir: string, filePattern?: RegExp): string[] {
  const files: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          files.push(...walkDir(path.join(dir, entry.name), filePattern))
        }
      } else if (entry.isFile()) {
        const fullPath = path.join(dir, entry.name)
        if (!filePattern || filePattern.test(entry.name)) {
          if (isTextFile(fullPath)) {
            files.push(fullPath)
          }
        }
      }
    }
  } catch {}
  return files
}

export const grepTool = {
  name: "grep",
  description: "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Use this to find where functions are called, variables are defined, or patterns appear in the codebase.",
  schema: { pattern: "string", path: "string", fileTypes: "string", maxResults: "number" },
  async execute(args: { pattern: string; path?: string; fileTypes?: string; maxResults?: number }) {
    const root = args.path ? path.resolve(WORKSPACE, args.path) : WORKSPACE
    if (!root.startsWith(WORKSPACE)) {
      return { success: false, error: "Path is outside workspace" }
    }

    const filePattern = args.fileTypes
      ? new RegExp(args.fileTypes.replace(/\*/g, ".*").replace(/,/g, "|"))
      : undefined

    const maxResults = args.maxResults ?? 50
    const matches: Match[] = []
    let searched = 0

    const files = walkDir(root, filePattern)
    const regex = new RegExp(args.pattern, "gi")

    for (const filePath of files) {
      if (matches.length >= maxResults) break
      searched++
      try {
        const content = fs.readFileSync(filePath, "utf-8")
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({
              file: path.relative(WORKSPACE, filePath).replace(/\\/g, "/"),
              line: i + 1,
              content: lines[i].trim(),
            })
            if (matches.length >= maxResults) break
          }
        }
      } catch {}
    }

    return {
      success: true,
      data: {
        pattern: args.pattern,
        matches,
        totalFilesSearched: searched,
        truncated: matches.length >= maxResults,
      },
    }
  },
  async verify(args: { pattern: string }, result: { success: boolean; data?: { matches: unknown[] } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!Array.isArray(result.data?.matches)) {
      return { verified: false, discrepancy: "Result matches is not an array" }
    }
    return { verified: true, evidence: { matchCount: result.data!.matches.length } }
  },
}
