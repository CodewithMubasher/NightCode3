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

export const deleteFileTool = {
  name: "delete_file",
  description: "Delete a file or directory (recursively).",
  schema: { path: "string" },
  async execute(args: { path: string }) {
    const resolved = resolvePath(args.path)
    fs.rmSync(resolved, { recursive: true, force: true })
    return { success: true, data: { path: args.path } }
  },
  async verify(args: { path: string }, result: { success: boolean }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    try {
      const resolved = resolvePath(args.path)
      if (fs.existsSync(resolved)) {
        return { verified: false, discrepancy: "File still exists after deletion" }
      }
      return { verified: true, evidence: { path: args.path, deleted: true } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
