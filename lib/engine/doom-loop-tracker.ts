import crypto from "crypto"

export interface DoomLoopResult {
  isDoomLoop: boolean
  matchedCount: number
  toolName: string
  argsHash: string
}

export class DoomLoopTracker {
  private history: Array<{ toolName: string; argsHash: string }> = []
  private readonly maxHistory: number

  constructor(maxHistory = 10) {
    this.maxHistory = maxHistory
  }

  private hash(args: Record<string, unknown> | null | undefined): string {
    const safe = args ?? {}
    const stable = JSON.stringify(safe, Object.keys(safe).sort())
    return crypto.createHash("md5").update(stable).digest("hex").slice(0, 8)
  }

  check(toolName: string, args: Record<string, unknown> | null | undefined): DoomLoopResult {
    const argsHash = this.hash(args)

    if (this.history.length < 3) {
      return { isDoomLoop: false, matchedCount: 0, toolName, argsHash }
    }

    const last3 = this.history.slice(-3)
    const allMatch = last3.every((h) => h.toolName === toolName && h.argsHash === argsHash)

    return {
      isDoomLoop: allMatch,
      matchedCount: allMatch ? last3.length : 0,
      toolName,
      argsHash,
    }
  }

  record(toolName: string, args: Record<string, unknown> | null | undefined): void {
    const argsHash = this.hash(args)
    this.history.push({ toolName, argsHash })
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory)
    }
  }

  reset(): void {
    this.history = []
  }
}
