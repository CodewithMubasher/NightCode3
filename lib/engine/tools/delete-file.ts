import * as fs from "fs"
import { resolvePath as resolveWorkspacePath } from "../path-utils"

function resolvePath(filePath: string): string {
  return resolveWorkspacePath(filePath)
}

export const deleteFileTool = {
  name: "delete_file",
  description: "Delete a file or directory (recursively). Use relative paths like 'project/file.html', never absolute paths.",
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
