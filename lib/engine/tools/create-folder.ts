import * as fs from "fs"
import { resolvePath as resolveWorkspacePath } from "../path-utils"

function resolvePath(dirPath: string): string {
  return resolveWorkspacePath(dirPath)
}

export const createFolderTool = {
  name: "create_folder",
  description: "Create a new directory. Creates parent directories automatically. Use relative paths like 'project/images', never absolute paths.",
  schema: { path: "string" },
  async execute(args: { path: string }) {
    const resolved = resolvePath(args.path)
    fs.mkdirSync(resolved, { recursive: true })
    return { success: true, data: { path: args.path } }
  },
  async verify(args: { path: string }, result: { success: boolean }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    try {
      const resolved = resolvePath(args.path)
      if (!fs.existsSync(resolved)) {
        return { verified: false, discrepancy: "Directory was not created on disk" }
      }
      if (!fs.statSync(resolved).isDirectory()) {
        return { verified: false, discrepancy: "Path exists but is not a directory" }
      }
      return { verified: true, evidence: { path: args.path } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
