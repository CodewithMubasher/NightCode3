import { SessionCache } from "./session-cache"
import { FileCache } from "./file-cache"
import { McpCache } from "./mcp-cache"

export class CacheManager {
  readonly session: SessionCache
  readonly file: FileCache
  readonly mcp: McpCache

  constructor() {
    this.session = new SessionCache()
    this.file = new FileCache()
    this.mcp = new McpCache()
  }

  /** Clear all caches. */
  clear(): void {
    this.session.clear()
    this.file.clear()
    this.mcp.clear()
  }

  /** Prune stale entries across all caches. */
  prune(): void {
    this.file.prune()
    this.mcp.prune()
  }
}

export { SessionCache } from "./session-cache"
export { FileCache } from "./file-cache"
export { McpCache, type McpToolDef } from "./mcp-cache"
