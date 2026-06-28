export interface ToolTelemetry {
  name: string
  latencyMs: number
  cached: boolean
  success: boolean
}

export class Telemetry {
  provider = ""
  model = ""
  stepCount = 0
  reasoningTimeMs = 0
  inputTokens = 0
  outputTokens = 0
  tools: ToolTelemetry[] = []
  contextUtilization = 0
  contextMax = 0
  contextCompacted = false
  fileCacheHits = 0
  startedAt = 0
  apiTimeMs = 0

  start(): void {
    this.startedAt = Date.now()
  }

  addToolCall(name: string, latencyMs: number, cached: boolean, success: boolean): void {
    this.tools.push({ name, latencyMs, cached, success })
  }

  get cacheHits(): number {
    return this.tools.filter((t) => t.cached).length
  }

  get cacheMisses(): number {
    return this.tools.filter((t) => !t.cached).length
  }

  get totalToolLatencyMs(): number {
    return this.tools.reduce((sum, t) => sum + t.latencyMs, 0)
  }

  get avgToolLatencyMs(): number {
    return this.tools.length > 0 ? Math.round(this.totalToolLatencyMs / this.tools.length) : 0
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt
  }

  get tokensPerSec(): number {
    const elapsed = this.elapsedMs / 1000
    return elapsed > 0 ? Math.round(this.outputTokens / elapsed) : 0
  }

  print(): void {
    const sep = "=".repeat(28)
    console.log(`\n${sep} ENGINE ${sep}`)
    console.log(`Provider: ${this.provider}`)
    console.log(`Model: ${this.model}`)
    console.log()
    console.log("Planning:")
    console.log(`  Step Count: ${this.stepCount}`)
    console.log(`  Reasoning Time: ${(this.reasoningTimeMs / 1000).toFixed(1)}s`)
    console.log()
    console.log("Generation:")
    console.log(`  Input Tokens: ${this.inputTokens.toLocaleString()}`)
    console.log(`  Output Tokens: ${this.outputTokens.toLocaleString()}`)
    console.log(`  Speed: ${this.tokensPerSec} tok/s`)
    console.log()
    console.log("Tools:")
    console.log(`  Calls: ${this.tools.length}`)
    if (this.tools.length > 0) {
      console.log(`  Avg Tool Latency: ${this.avgToolLatencyMs}ms`)
      console.log(`  Cache Hits: ${this.cacheHits}`)
      console.log(`  Cache Misses: ${this.cacheMisses}`)
    }
    console.log()
    console.log("Context:")
    console.log(`  Window: ${(this.contextUtilization / 1000).toFixed(0)}K / ${(this.contextMax / 1000).toFixed(0)}K`)
    console.log(`  Compaction: ${this.contextCompacted ? "Yes" : "No"}`)
    console.log()
    console.log("Network:")
    console.log(`  API Time: ${(this.apiTimeMs / 1000).toFixed(1)}s`)
    console.log(`${sep}${"=".repeat(28)}\n`)
  }
}
