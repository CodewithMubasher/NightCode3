import * as fs from "fs"

export type CachedResultType = "json" | "text" | "error" | "content"

export interface CachedResult {
  value: unknown
  resultType: CachedResultType
  cachedAt: number
}

type CacheKey = string

function stableArgs(args: Record<string, unknown> | null | undefined): string {
  const safe = args ?? {}
  const sorted = Object.keys(safe).sort().reduce(
    (acc, k) => { acc[k] = safe[k]; return acc },
    {} as Record<string, unknown>,
  )
  return JSON.stringify(sorted)
}

function buildKey(toolName: string, args: Record<string, unknown> | null | undefined): CacheKey {
  return `${toolName}:${stableArgs(args)}`
}

const WRITE_TOOLS = new Set(["write_file", "edit_file"])
const READ_TOOLS = new Set(["read_file", "list_directory", "glob"])
const NEVER_CACHE = new Set(["execute_command", "bash", "run_terminal"])

/** Cache file mtime for quick stat-less validity checks within the same engine run. */
const mtimeCache = new Map<string, number>()

export class SessionCache {
  private results = new Map<CacheKey, CachedResult>()
  private neverCache = NEVER_CACHE

  /** Look up a cached tool result. Returns null if not found or stale. */
  async get(toolName: string, args: Record<string, unknown> | null | undefined): Promise<CachedResult | null> {
    if (this.neverCache.has(toolName)) return null

    const key = buildKey(toolName, args)
    const cached = this.results.get(key)
    if (!cached) return null

    // File-based tools: verify file hasn't been modified since cached
    if (READ_TOOLS.has(toolName) && args && args.path && typeof args.path === "string") {
      const p = args.path
      try {
        const stat = await fs.promises.stat(p)
        const cachedMtime = mtimeCache.get(p)
        if (cachedMtime != null && stat.mtimeMs !== cachedMtime) {
          this.results.delete(key)
          return null
        }
      } catch {
        this.results.delete(key)
        return null
      }
    }

    return cached
  }

  /** Store a tool result in the cache. */
  set(
    toolName: string,
    args: Record<string, unknown> | null | undefined,
    result: CachedResult,
  ): void {
    if (this.neverCache.has(toolName)) return

    const key = buildKey(toolName, args)

    // For file reads, record mtime for validity checks
    if (READ_TOOLS.has(toolName) && args && typeof args.path === "string") {
      const p = args.path
      fs.promises.stat(p).then(
        (stat) => mtimeCache.set(p, stat.mtimeMs),
        () => {},
      )
    }

    this.results.set(key, result)
  }

  /** Invalidate cache entries affected by a write tool. */
  invalidate(toolName: string, args: Record<string, unknown> | null | undefined): void {
    if (WRITE_TOOLS.has(toolName) && args && args.path && typeof args.path === "string") {
      mtimeCache.delete(args.path)
      // Invalidate all session cache entries referencing this path
      const pathStr = args.path as string
      for (const key of this.results.keys()) {
        if (key.includes(pathStr)) this.results.delete(key)
      }
    }

    if (toolName === "write_file" || toolName === "edit_file") {
      for (const key of this.results.keys()) {
        if (key.startsWith("glob:") || key.startsWith("list_directory:")) {
          this.results.delete(key)
        }
      }
    }
  }

  clear(): void {
    this.results.clear()
    mtimeCache.clear()
  }

  get size(): number {
    return this.results.size
  }
}
