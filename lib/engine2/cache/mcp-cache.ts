const DEFAULT_TTL = 60_000 // 60 seconds

interface McpToolsEntry {
  tools: McpToolDef[]
  cachedAt: number
  serverName: string
}

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export class McpCache {
  private serverTools = new Map<string, McpToolsEntry>()
  private ttl: number

  constructor(ttl = DEFAULT_TTL) {
    this.ttl = ttl
  }

  getTools(serverName: string): McpToolDef[] | null {
    const entry = this.serverTools.get(serverName)
    if (!entry) return null

    const age = Date.now() - entry.cachedAt
    if (age > this.ttl) {
      this.serverTools.delete(serverName)
      return null
    }

    return entry.tools
  }

  setTools(serverName: string, tools: McpToolDef[]): void {
    this.serverTools.set(serverName, {
      tools,
      cachedAt: Date.now(),
      serverName,
    })
  }

  has(serverName: string): boolean {
    return this.serverTools.has(serverName)
  }

  invalidate(serverName: string): void {
    this.serverTools.delete(serverName)
  }

  clear(): void {
    this.serverTools.clear()
  }

  /** Returns all cached server names. */
  get servers(): string[] {
    return Array.from(this.serverTools.keys())
  }

  /** Prune stale entries. */
  prune(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.serverTools) {
      if (now - entry.cachedAt > this.ttl * 2) {
        this.serverTools.delete(key)
        removed++
      }
    }
    return removed
  }
}
