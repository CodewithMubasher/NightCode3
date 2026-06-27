import * as fs from "fs"
import * as path from "path"
import { resolvePath as resolveWorkspacePath } from "../path-utils"

function resolvePath(dirPath: string): string {
  return resolveWorkspacePath(dirPath)
}

function globSync(pattern: string, root: string): string[] {
  const results: string[] = []
  const parts = pattern.replace(/\\/g, "/").split("/")
  const stack: { dir: string; idx: number }[] = [{ dir: root, idx: 0 }]
  while (stack.length > 0) {
    const { dir, idx } = stack.pop()!
    if (idx >= parts.length) { results.push(dir); continue }
    const part = parts[idx]
    if (part === "**") {
      stack.push({ dir, idx: idx + 1 })
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            stack.push({ dir: path.join(dir, entry.name), idx })
          }
        }
      } catch { /* skip unreadable */ }
    } else if (part.includes("*") || part.includes("?")) {
      const regex = new RegExp("^" + part.replace(/\*/g, ".*").replace(/\?/g, ".") + "$")
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (regex.test(entry.name)) {
            stack.push({ dir: path.join(dir, entry.name), idx: idx + 1 })
          }
        }
      } catch { /* skip unreadable */ }
    } else {
      const next = path.join(dir, part)
      try {
        if (fs.existsSync(next)) {
          stack.push({ dir: next, idx: idx + 1 })
        }
      } catch { /* skip unreadable */ }
    }
  }
  return results.map((r) => path.relative(root, r).replace(/\\/g, "/"))
}

export const searchFilesTool = {
  name: "search_files",
  description: "Search for files matching a glob pattern (e.g. '**/*.py', 'src/**/*.ts'). Returns relative paths.",
  schema: { pattern: "string", path: "string" },
  async execute(args: { pattern: string; path: string }) {
    const resolved = resolvePath(args.path)
    const files = globSync(args.pattern, resolved)
    return { success: true, data: { pattern: args.pattern, files } }
  },
  async verify(_args: { pattern: string; path: string }, result: { success: boolean; data?: { files: unknown[] } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!Array.isArray(result.data?.files)) {
      return { verified: false, discrepancy: "Result files is not an array" }
    }
    return { verified: true, evidence: { count: result.data!.files.length } }
  },
}
