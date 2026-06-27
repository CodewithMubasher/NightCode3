import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function resolvePath(dirPath: string): string {
  let resolved = path.isAbsolute(dirPath) ? dirPath : path.resolve(WORKSPACE, dirPath)
  resolved = path.normalize(resolved)
  return resolved
}

// In-memory directory listing cache with TTL
const listingCache = new Map<string, { items: Array<{ name: string; type: string; size: number | null }>; timestamp: number }>()
const CACHE_TTL_MS = 60_000

export function invalidateListingCache(dirPath?: string): void {
  if (dirPath) {
    const resolved = path.isAbsolute(dirPath) ? dirPath : path.resolve(WORKSPACE, dirPath)
    listingCache.delete(path.normalize(resolved))
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
      return { success: false, error: `Directory not found: ${args.path ?? "."}` }
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
