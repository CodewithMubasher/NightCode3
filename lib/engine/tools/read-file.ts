import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function resolvePath(filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE, filePath)
  const normalized = path.normalize(resolved)
  if (!normalized.startsWith(WORKSPACE)) {
    throw new Error(`Path traversal denied: "${filePath}" is outside the workspace`)
  }
  return normalized
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
      const stat = fs.statSync(resolved)
      const expectedSize = result.data?.content?.length ?? 0
      return { verified: true, evidence: { path: args.path, size: stat.size, expectedSize } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
