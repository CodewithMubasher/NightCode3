import * as fs from "fs"
import * as path from "path"
import { resolvePath as resolveWorkspacePath } from "../path-utils"

function resolvePath(dirPath: string): string {
  return resolveWorkspacePath(dirPath)
}

// In-memory directory listing cache with TTL
const listingCache = new Map<string, { items: Array<{ name: string; type: string; size: string | number | null }>; timestamp: number }>()
const CACHE_TTL_MS = 60_000

export function invalidateListingCache(dirPath?: string): void {
  if (dirPath) {
    listingCache.delete(resolvePath(dirPath))
  } else {
    listingCache.clear()
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const listDirectoryTool = {
  name: "list_directory",
  description: "List files and directories at a path. Returns names, types (file/dir), and sizes in human-readable format. Defaults to workspace root. The result is cached for 60 seconds and auto-invalidated after write operations.",
  schema: { path: "string?" },
  async execute(args: { path?: string }) {
    const resolved = resolvePath(args.path ?? ".")
    if (!fs.existsSync(resolved)) {
      const isAbs = path.isAbsolute(args.path ?? ".")
      return {
        success: false,
        error: `Directory not found: ${args.path ?? "."}` +
          (isAbs ? ` (absolute path resolved to: ${resolved})` : "") +
          `. Try: 1) check the path is correct, 2) use list_directory with no args to see workspace root, 3) use an absolute path like F:/Projects/...`
      }
    }
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return { success: false, error: `"${args.path ?? "."}" is not a directory.` }
    }

    const cached = listingCache.get(resolved)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { success: true, data: { path: args.path ?? ".", items: cached.items, _cached: true } }
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const items = entries
      .filter((e) => !e.name.startsWith(".") || e.name === ".env")
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
      }))
      .sort((a, b) => {
        // Dirs first, then files, alphabetical within each group
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map((item) => ({
        ...item,
        size: item.type === "file" && item.size !== null ? formatSize(item.size) : item.size,
      }))

    listingCache.set(resolved, { items, timestamp: Date.now() })
    return { success: true, data: { path: args.path ?? ".", items } }
  },
  async verify(_args: { path?: string }, result: { success: boolean; data?: { items: unknown[] } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!Array.isArray(result.data?.items)) {
      return { verified: false, discrepancy: "Result items is not an array" }
    }
    return { verified: true, evidence: { count: result.data!.items.length } }
  },
}
