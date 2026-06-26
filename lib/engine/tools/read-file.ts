import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function resolvePath(filePath: string): string {
  let resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE, filePath)
  resolved = path.normalize(resolved)
  if (process.platform === "win32") {
    resolved = resolved.replace(/\//g, "\\")
  }
  return resolved
}

export const readFileTool = {
  name: "read_file",
  description: "Read the contents of a file (relative path). Optionally specify offset (1-based line number) and limit (number of lines) to read a specific section instead of the entire file.",
  schema: { path: "string", offset: "number", limit: "number" },
  async execute(args: { path: string; offset?: number; limit?: number }) {
    const resolved = resolvePath(args.path)
    const content = fs.readFileSync(resolved, "utf-8")

    if (args.offset || args.limit) {
      const lines = content.split("\n")
      const start = args.offset ? Math.max(0, args.offset - 1) : 0
      const count = args.limit ?? lines.length
      const sliced = lines.slice(start, start + count)
      return {
        success: true,
        data: {
          content: sliced.join("\n"),
          path: args.path,
          totalLines: lines.length,
          startLine: start + 1,
          endLine: start + sliced.length,
        },
      }
    }

    return { success: true, data: { content, path: args.path, size: content.length } }
  },
  async verify(args: { path: string }, result: { success: boolean; data?: { content: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    try {
      const resolved = resolvePath(args.path)
      if (!fs.existsSync(resolved)) {
        return { verified: false, discrepancy: "File does not exist on disk" }
      }
      const stat = fs.statSync(resolved)
      const expectedSize = result.data?.content?.length ?? 0
      return { verified: true, evidence: { path: args.path, size: stat.size, expectedSize } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
