import * as fs from "fs"
import * as crypto from "crypto"

interface FileEntry {
  content: string
  hash: string
  mtime: number
  size: number
  cachedAt: number
}

const DEFAULT_TTL = 30_000 // 30 seconds

export class FileCache {
  private store = new Map<string, FileEntry>()
  private ttl: number

  constructor(ttl = DEFAULT_TTL) {
    this.ttl = ttl
  }

  async get(path: string): Promise<{ content: string; hash: string } | null> {
    const cached = this.store.get(path)
    if (!cached) return null

    try {
      const stat = await fs.promises.stat(path)
      if (stat.mtimeMs !== cached.mtime || stat.size !== cached.size) {
        this.store.delete(path)
        return null
      }

      const age = Date.now() - cached.cachedAt
      if (age > this.ttl) {
        this.store.delete(path)
        return null
      }

      return { content: cached.content, hash: cached.hash }
    } catch {
      this.store.delete(path)
      return null
    }
  }

  async set(path: string, content: string): Promise<string> {
    const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)

    try {
      const stat = await fs.promises.stat(path)
      this.store.set(path, {
        content,
        hash,
        mtime: stat.mtimeMs,
        size: stat.size,
        cachedAt: Date.now(),
      })
    } catch {
      // Path might not exist yet (e.g., for write_file we cache nothing)
      // Or it was deleted between stat and now — store anyway with 0 mtime
      this.store.set(path, {
        content,
        hash,
        mtime: 0,
        size: content.length,
        cachedAt: Date.now(),
      })
    }

    return hash
  }

  has(path: string): boolean {
    return this.store.has(path)
  }

  invalidate(path: string): void {
    this.store.delete(path)
  }

  invalidateGlob(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }

  /** Remove stale entries in bulk. */
  prune(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.store) {
      if (now - entry.cachedAt > this.ttl * 2) {
        this.store.delete(key)
        removed++
      }
    }
    return removed
  }
}
