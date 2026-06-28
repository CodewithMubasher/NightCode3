import type { KeyHealth } from "./key-pool"
import { PROVIDER_CONFIGS } from "./types"

export interface ProviderHealthReport {
  provider: string
  totalKeys: number
  healthyKeys: number
  cooldownKeys: number
  deadKeys: number
  avgLatencyMs: number | null
  isAvailable: boolean
}

export class HealthMonitor {
  private recoveryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private checkInterval: ReturnType<typeof setInterval> | null = null

  startPeriodicChecks(getAllKeys: () => Map<string, KeyHealth[]>, intervalMs = 60_000): void {
    if (this.checkInterval) return
    this.checkInterval = setInterval(() => {
      this.recoverStaleKeys(getAllKeys)
    }, intervalMs)
  }

  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  /** Promote a key from cooldown/dead back to healthy after timeout. */
  scheduleRecovery(key: KeyHealth, delayMs: number): void {
    const id = `${key.slot.provider}:${key.slot.value}`
    const existing = this.recoveryTimers.get(id)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      if (key.status !== "dead") {
        key.status = "healthy"
        key.consecutiveFailures = 0
      }
      this.recoveryTimers.delete(id)
    }, delayMs)

    this.recoveryTimers.set(id, timer)
  }

  getReport(provider: string, keys: KeyHealth[]): ProviderHealthReport {
    const totalKeys = keys.length
    const healthyKeys = keys.filter((k) => k.status === "healthy").length
    const cooldownKeys = keys.filter((k) => k.status === "cooldown").length
    const deadKeys = keys.filter((k) => k.status === "dead").length

    const latencies = keys.flatMap((k) => k.latencyMs)
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null

    const now = Date.now()
    const isAvailable = keys.some(
      (k) => k.status !== "dead" && (k.status !== "cooldown" || k.cooldownUntil <= now),
    )

    return {
      provider,
      totalKeys,
      healthyKeys,
      cooldownKeys,
      deadKeys,
      avgLatencyMs,
      isAvailable,
    }
  }

  private recoverStaleKeys(getAllKeys: () => Map<string, KeyHealth[]>): void {
    const now = Date.now()
    const allKeys = getAllKeys()

    for (const [, keys] of allKeys) {
      for (const k of keys) {
        if (k.status === "cooldown" && k.cooldownUntil <= now) {
          k.status = "healthy"
          k.consecutiveFailures = Math.max(0, k.consecutiveFailures - 1)
        }
        if (k.status === "dead" && this.hasBeenDeadLongEnough(k)) {
          k.status = "cooldown"
          k.cooldownUntil = now + 60_000 // 1 min grace before healthy
        }
      }
    }
  }

  private hasBeenDeadLongEnough(key: KeyHealth): boolean {
    const deadDuration = key.lastFailure ? Date.now() - key.lastFailure : 0
    return deadDuration >= 30 * 60 * 1000 // 30 min dead → promote to cooldown
  }
}
