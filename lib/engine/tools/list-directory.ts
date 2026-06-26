import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function resolvePath(dirPath: string): string {
  let resolved = path.isAbsolute(dirPath) ? dirPath : path.resolve(WORKSPACE, dirPath)
  resolved = path.normalize(resolved)
  if (process.platform === "win32") {
    resolved = resolved.replace(/\//g, "\\")
  }
  return resolved
}

// In-memory directory listing cache with TTL — avoids redundant listings within a session
const listingCache = new Map<string, { items: Array<{ name: string; type: string; size: number | null }>; timestamp: number }>()
const CACHE_TTL_MS = 60_000

export const listDirectoryTool = {
  name: "list_directory",
  description: "List files and directories at a path.",
  schema: { path: "string" },
  async execute(args: { path: string }) {
    const resolved = resolvePath(args.path)
    const cached = listingCache.get(resolved)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { success: true, data: { path: args.path, items: cached.items, _cached: true } }
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const items = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
      size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
    }))
    listingCache.set(resolved, { items, timestamp: Date.now() })
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
