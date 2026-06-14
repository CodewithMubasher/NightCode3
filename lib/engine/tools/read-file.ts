import * as fs from "fs"
import * as path from "path"

const WORKSPACE = process.env.BUILD_WORKSPACE || process.cwd()

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(WORKSPACE, filePath)
}

export const readFileTool = {
  name: "read_file",
  description: "Read the contents of a file.",
  schema: { path: "string" },
  async execute(args: { path: string }) {
    const resolved = resolvePath(args.path)
    const content = fs.readFileSync(resolved, "utf-8")
    return { success: true, data: { content, path: args.path, size: content.length } }
  },
  async verify(args: { path: string }, result: { success: boolean; data?: { content: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    try {
      const resolved = resolvePath(args.path)
      if (!fs.existsSync(resolved)) {
        return { verified: false, discrepancy: "File does not exist on disk" }
      }
      const actual = fs.readFileSync(resolved, "utf-8")
      if (actual !== result.data?.content) {
        return { verified: false, discrepancy: "File content mismatch between returned and actual" }
      }
      return { verified: true, evidence: { path: args.path, size: actual.length } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
