import * as path from "path"

export interface CachedFile {
  content: string
  totalLines: number
}

export interface CachedDirectory {
  items: string[]
  depth: number
}

export interface KnownFact {
  key: string
  value: string
  source: string
}

export class WorkingMemory {
  private files = new Map<string, CachedFile & { accessedAt: number }>()
  private directories = new Map<string, CachedDirectory>()
  private facts: KnownFact[] = []
  private recentlyRead = new Set<string>()

  getFile(filePath: string): (CachedFile & { accessedAt: number }) | undefined {
    return this.files.get(path.normalize(filePath))
  }

  hasFile(filePath: string): boolean {
    return this.files.has(path.normalize(filePath))
  }

  setFile(filePath: string, content: string, totalLines: number): void {
    const key = path.normalize(filePath)
    this.files.set(key, { content, totalLines, accessedAt: Date.now() })
    this.recentlyRead.add(key)
    this.addFact(`file:${key}`, `Read ${key} (${totalLines} lines)`, "read_file")
    this.extractFacts(key, content)
  }

  invalidateFile(filePath: string): void {
    const key = path.normalize(filePath)
    this.files.delete(key)
    this.recentlyRead.delete(key)
  }

  getDirectory(dirPath: string): CachedDirectory | undefined {
    return this.directories.get(path.normalize(dirPath))
  }

  hasDirectory(dirPath: string): boolean {
    return this.directories.has(path.normalize(dirPath))
  }

  setDirectory(dirPath: string, items: string[], depth: number): void {
    const key = path.normalize(dirPath)
    this.directories.set(key, { items, depth })
    this.addFact(`dir:${key}`, `Listed ${key} (${items.length} entries)`, "list_directory")
  }

  invalidateDirectory(dirPath: string): void {
    const key = path.normalize(dirPath)
    this.directories.delete(key)
  }

  addFact(key: string, value: string, source: string): void {
    const existing = this.facts.findIndex((f) => f.key === key)
    if (existing !== -1) {
      this.facts[existing] = { key, value, source }
      return
    }
    this.facts.push({ key, value, source })
  }

  getFact(key: string): string | undefined {
    return this.facts.find((f) => f.key === key)?.value
  }

  hasRecentRead(filePath: string): boolean {
    return this.recentlyRead.has(path.normalize(filePath))
  }

  markRecentlyRead(filePath: string): void {
    this.recentlyRead.add(path.normalize(filePath))
  }

  summarize(): string {
    if (this.files.size === 0 && this.facts.length === 0) return ""

    const parts: string[] = []

    if (this.files.size > 0) {
      parts.push("=== FILES ALREADY READ (do NOT read again) ===")
      for (const [filePath, entry] of this.files.entries()) {
        const lines = entry.content.split("\n")
        const preview = lines.length <= 50
          ? entry.content
          : lines.slice(0, 50).join("\n") + `\n... (${lines.length - 50} more lines)`
        parts.push(`--- ${filePath} ---\n${preview}`)
      }
      parts.push("=== END CACHED FILES ===")
    }

    const nonFileFacts = this.facts.filter((f) => !f.key.startsWith("file:"))
    if (nonFileFacts.length > 0) {
      parts.push("=== FACTS DISCOVERED ===")
      for (const f of nonFileFacts) {
        parts.push(`  ${f.key}: ${f.value}`)
      }
    }

    return parts.join("\n\n")
  }

  extractFacts(filePath: string, content: string): void {
    if (filePath.endsWith("package.json")) {
      try {
        const pkg = JSON.parse(content)
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>
        for (const [name, version] of Object.entries(allDeps)) {
          this.addFact(`dep:${name}`, `${name} ${version}`, "package.json")
        }
        if (pkg.name) this.addFact("project:name", pkg.name, "package.json")
        if (pkg.scripts) {
          this.addFact("project:scripts", Object.keys(pkg.scripts).join(", "), "package.json")
        }
      } catch {}
    }

    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      const exports: string[] = []
      const regex = /^export\s+(const|function|class|type|interface)\s+(\w+)/gm
      let m: RegExpExecArray | null
      while ((m = regex.exec(content)) !== null) {
        exports.push(m[2])
      }
      if (exports.length > 0) {
        this.addFact(`exports:${filePath}`, `${filePath} exports: ${exports.slice(0, 15).join(", ")}`, "file_scan")
      }
    }
  }

  clear(): void {
    this.files.clear()
    this.directories.clear()
    this.facts = []
    this.recentlyRead.clear()
  }
}
