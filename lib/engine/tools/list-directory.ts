import * as fs from "fs"
import * as path from "path"

const WORKSPACE = process.env.BUILD_WORKSPACE || process.cwd()

function resolvePath(dirPath: string): string {
  if (path.isAbsolute(dirPath)) return dirPath
  return path.resolve(WORKSPACE, dirPath)
}

export const listDirectoryTool = {
  name: "list_directory",
  description: "List files and directories at a path.",
  schema: { path: "string" },
  async execute(args: { path: string }) {
    const resolved = resolvePath(args.path)
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const items = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
      size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
    }))
    return { success: true, data: { path: args.path, items } }
  },
  async verify(_args: { path: string }, result: { success: boolean; data?: { items: unknown[] } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!Array.isArray(result.data?.items)) {
      return { verified: false, discrepancy: "Result items is not an array" }
    }
    return { verified: true, evidence: { count: result.data!.items.length } }
  },
}
