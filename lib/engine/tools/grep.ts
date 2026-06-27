import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".db", "cache", ".turbo", ".cache"])

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".mdx", ".css", ".scss", ".html", ".yml", ".yaml", ".toml",
  ".py", ".rb", ".go", ".rs", "java", ".kt", ".swift",
  ".sh", ".bash", ".ps1", ".bat",
  ".sql", ".graphql", ".prisma",
  ".env", ".txt", ".xml", ".svg", ".vue", ".svelte", ".astro",
])

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return true
  // Allow extensionless well-known config files
  const base = path.basename(filePath).toLowerCase()
  return ["dockerfile", "makefile", "rakefile", "gemfile", ".gitignore", ".env"].includes(base)
}

interface Match {
  file: string
  line: number
  column: number
  content: string
  contextBefore: string[]
  contextAfter: string[]
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
  } catch (e) { console.error("[grep] Failed to walk dir:", e) }
  return files
}

function safeBuildRegex(pattern: string, ignoreCase: boolean): RegExp | null {
  try {
    return new RegExp(pattern, ignoreCase ? "i" : "")
    // NOTE: no "g" flag — a global regex is stateful when used with .test()
    // in a loop, silently alternating true/false. We use .match() / .search()
    // instead, which do not mutate lastIndex.
  } catch {
    return null
  }
}

export const grepTool = {
  name: "grep",
  description: "Search file contents for a pattern (regex or literal). Returns matching lines with file paths, line numbers, and 2 lines of context on each side. Use this to find where functions/variables are defined or called, or to locate code before editing. Parameters: pattern (regex), path (optional, defaults to workspace root), fileTypes (optional glob like '*.ts,*.tsx' to filter by name), maxResults (optional, default 30), ignoreCase (optional boolean), context (optional lines of context, default 2).",
  schema: {
    pattern: "string",
    path: "string?",
    fileTypes: "string?",
    maxResults: "number?",
    ignoreCase: "boolean?",
    context: "number?",
  },
  async execute(args: {
    pattern: string
    path?: string
    fileTypes?: string
    maxResults?: number
    ignoreCase?: boolean
    context?: number
  }) {
    const root = args.path
      ? (path.isAbsolute(args.path) ? args.path : path.resolve(WORKSPACE, args.path))
      : WORKSPACE

    const filePattern = args.fileTypes
      ? new RegExp(args.fileTypes.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/,/g, "|") + "$")
      : undefined

    const maxResults = Math.min(args.maxResults ?? 30, 200)
    const contextLines = Math.max(0, Math.min(args.context ?? 2, 5))
    const ignoreCase = args.ignoreCase ?? false

    if (!fs.existsSync(root)) {
      return { success: false, error: `Path does not exist: ${args.path ?? root}` }
    }
    // search a single file too
    let files: string[]
    try {
      const stat = fs.statSync(root)
      files = stat.isFile() ? [root] : walkDir(root, filePattern)
    } catch {
      files = walkDir(root, filePattern)
    }

    const regex = safeBuildRegex(args.pattern, ignoreCase)
    if (!regex) {
      return { success: false, error: `Invalid regex pattern: ${args.pattern}` }
    }

    const matches: Match[] = []
    const fileMatchCounts = new Map<string, number>()
    let searched = 0

    for (const filePath of files) {
      if (matches.length >= maxResults) break
      searched++
      let content: string
      try {
        content = fs.readFileSync(filePath, "utf-8")
      } catch {
        continue
      }
      const lines = content.split("\n")
      const rel = path.relative(WORKSPACE, filePath).replace(/\\/g, "/")
      for (let i = 0; i < lines.length; i++) {
        // .search() is non-stateful — safe to call repeatedly unlike .test() on a g-flag regex
        const col = lines[i].search(regex)
        if (col === -1) continue
        matches.push({
          file: rel,
          line: i + 1,
          column: col + 1,
          content: lines[i].trimEnd(),
          contextBefore: contextLines > 0 ? lines.slice(Math.max(0, i - contextLines), i).map((l) => l.trimEnd()) : [],
          contextAfter: contextLines > 0 ? lines.slice(i + 1, i + 1 + contextLines).map((l) => l.trimEnd()) : [],
        })
        fileMatchCounts.set(rel, (fileMatchCounts.get(rel) ?? 0) + 1)
        if (matches.length >= maxResults) break
      }
    }

    // Group output by file for readability
    const byFile = new Map<string, Match[]>()
    for (const m of matches) {
      const arr = byFile.get(m.file) ?? []
      arr.push(m)
      byFile.set(m.file, arr)
    }

    return {
      success: true,
      data: {
        pattern: args.pattern,
        matches,
        groupedByFile: Array.from(byFile.entries()).map(([file, ms]) => ({ file, matchCount: ms.length, matches: ms })),
        filesWithMatches: fileMatchCounts.size,
        totalFilesSearched: searched,
        truncated: matches.length >= maxResults,
        maxResults,
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
