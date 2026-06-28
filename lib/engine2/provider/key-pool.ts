import { SlidingWindowCounter } from "./rate-counter"
import { type KeyStatus, type KeySlot, type ProviderConfig, PROVIDER_CONFIGS, getToken, getBaseUrl } from "./types"

export interface KeyHealth {
  slot: KeySlot
  status: KeyStatus
  lastFailure: number | null
  lastSuccess: number | null
  cooldownUntil: number
  consecutiveFailures: number
  latencyMs: number[]
  rpm: SlidingWindowCounter
  tpm: SlidingWindowCounter
  rpd: SlidingWindowCounter
  tpd: SlidingWindowCounter
  totalRequests: number
  totalTokens: number
  label: string
}

export class KeyPool {
  private pools: Map<string, KeyHealth[]> = new Map()
  private initialized = false

  getKeys(provider: string): KeyHealth[] {
    this.ensureInitialized()
    return this.pools.get(provider) ?? []
  }

  getHealthiest(provider: string): KeyHealth | null {
    const keys = this.getKeys(provider)
    if (keys.length === 0) return null

    const now = Date.now()

    // Filter: healthy or cooldown expired, not exhausted
    const available = keys.filter((k) => {
      if (k.status === "dead") return false
      if (k.cooldownUntil > now && k.status === "cooldown") return false
      if (k.rpm.isExhausted) return false
      if (k.tpm.isExhausted) return false
      return true
    })

    if (available.length === 0) {
      // All are exhausted or dead — use the one closest to recovery
      const sorted = [...keys].sort((a, b) => {
        const aRecovery = a.cooldownUntil - now
        const bRecovery = b.cooldownUntil - now
        return aRecovery - bRecovery
      })
      return sorted[0] ?? null
    }

    // Score each key: lower RPM utilization + lower TPM utilization + lower latency = better
    const scored = available.map((k) => {
      const rpmScore = k.rpm.cappedUtilization
      const tpmScore = k.tpm.cappedUtilization
      const rpdScore = k.rpd.cappedUtilization
      const tpdScore = k.tpd.cappedUtilization
      const avgLatency = k.latencyMs.length > 0
        ? k.latencyMs.reduce((a, b) => a + b, 0) / k.latencyMs.length
        : 100
      const latencyScore = Math.min(1, avgLatency / 5000)
      const failurePenalty = Math.min(1, k.consecutiveFailures * 0.25)
      const totalScore = rpmScore * 0.25 + tpmScore * 0.25 + rpdScore * 0.1 + tpdScore * 0.1 + latencyScore * 0.2 + failurePenalty * 0.1
      return { key: k, score: totalScore }
    })

    scored.sort((a, b) => a.score - b.score)
    return scored[0].key
  }

  /** Returns providers with at least one usable key (not exhausted at 85%+). */
  getAvailableProviders(): string[] {
    this.ensureInitialized()
    const now = Date.now()
    const result: string[] = []

    for (const [provider, keys] of this.pools) {
      const usable = keys.some((k) => {
        if (k.status === "dead") return false
        if (k.cooldownUntil > now && k.status === "cooldown") return false
        if (k.rpm.isExhausted) return false
        if (k.tpd.utilization >= 0.85) return false
        if (k.rpd.utilization >= 0.85) return false
        if (k.tpm.utilization >= 0.85) return false
        return true
      })
      if (usable) result.push(provider)
    }

    return result
  }

  /** Returns keys sorted by remaining capacity (for "Recommended" section). */
  getRecommendedKeys(): Array<{ provider: string; key: KeyHealth; remaining: number }> {
    this.ensureInitialized()
    const now = Date.now()
    const result: Array<{ provider: string; key: KeyHealth; remaining: number }> = []

    for (const [provider, keys] of this.pools) {
      for (const k of keys) {
        if (k.status === "dead") continue
        if (k.cooldownUntil > now && k.status === "cooldown") continue
        const remaining = k.tpm.remaining + k.rpm.remaining * 1000
        if (remaining > 0) {
          result.push({ provider, key: k, remaining })
        }
      }
    }

    result.sort((a, b) => b.remaining - a.remaining)
    return result
  }

  reportSuccess(provider: string, keyValue: string, tokens: number, latencyMs: number): void {
    const keys = this.getKeys(provider)
    const key = keys.find((k) => k.slot.value === keyValue)
    if (!key) return

    key.status = "healthy"
    key.lastSuccess = Date.now()
    key.consecutiveFailures = 0
    key.latencyMs = [...key.latencyMs.slice(-9), latencyMs]
    key.totalRequests++
    key.totalTokens += tokens
    key.rpm.add(1)
    key.tpm.add(tokens)
    key.rpd.add(1)
    key.tpd.add(tokens)
  }

  reportFailure(provider: string, keyValue: string, statusCode: number, penaltyMs?: number): void {
    const keys = this.getKeys(provider)
    const key = keys.find((k) => k.slot.value === keyValue)
    if (!key) return

    key.lastFailure = Date.now()
    key.consecutiveFailures++

    const cfg = PROVIDER_CONFIGS[provider]
    const deadAfter = cfg?.deadAfterFailures ?? 3

    if (statusCode === 401 || statusCode === 403) {
      key.status = "dead"
      key.cooldownUntil = Date.now() + 24 * 60 * 60 * 1000 // 24h for auth failures
    } else if (statusCode === 429) {
      key.status = "cooldown"
      const cooldown = penaltyMs ?? cfg?.cooldownMs ?? 60_000
      key.cooldownUntil = Date.now() + Math.min(cooldown * key.consecutiveFailures, 300_000) // max 5min
    } else if (key.consecutiveFailures >= deadAfter) {
      key.status = "dead"
      key.cooldownUntil = Date.now() + 30 * 60 * 1000 // 30min
    } else {
      key.status = "cooldown"
      key.cooldownUntil = Date.now() + (cfg?.cooldownMs ?? 30_000)
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return
    this.loadKeys()
    this.initialized = true
  }

  private loadKeys(): void {
    for (const [providerName, cfg] of Object.entries(PROVIDER_CONFIGS)) {
      const slots = this.discoverKeys(providerName, cfg)
      if (slots.length === 0) {
        if (providerName !== "local") {
          console.warn(`[KeyPool] No keys found for provider "${providerName}" (env: ${cfg.keyEnvBase})`)
        }
        continue
      }

      const healthEntries: KeyHealth[] = slots.map((slot, idx) => ({
        slot,
        status: "healthy" as KeyStatus,
        lastFailure: null,
        lastSuccess: null,
        cooldownUntil: 0,
        consecutiveFailures: 0,
        latencyMs: [],
        rpm: new SlidingWindowCounter(60_000, cfg.rpmLimit),
        tpm: new SlidingWindowCounter(60_000, cfg.tpmLimit),
        rpd: new SlidingWindowCounter(86_400_000, cfg.rpdLimit),
        tpd: new SlidingWindowCounter(86_400_000, cfg.tpdLimit),
        totalRequests: 0,
        totalTokens: 0,
        label: slots.length > 1 ? `Key ${idx + 1}` : "default",
      }))

      this.pools.set(providerName, healthEntries)
    }
  }

  private discoverKeys(providerName: string, cfg: ProviderConfig): KeySlot[] {
    if (providerName === "local") {
      return [{ value: "local-no-auth", type: "BEARER", provider: providerName }]
    }

    const seen = new Set<string>()
    const slots: KeySlot[] = []

    const base = getToken(cfg.keyEnvBase)
    if (base && base.trim() && !seen.has(base.trim())) {
      seen.add(base.trim())
      slots.push({ value: base.trim(), type: cfg.authType, provider: providerName, label: "default" })
    }

    for (let i = 1; i <= cfg.maxKeys; i++) {
      const val = process.env[`${cfg.keyEnvBase}_${i}`]
      if (val && val.trim() && !seen.has(val.trim())) {
        seen.add(val.trim())
        slots.push({ value: val.trim(), type: cfg.authType, provider: providerName, label: `Key ${i}` })
      }
    }

    return slots
  }

  reloadKeys(): void {
    this.pools.clear()
    this.initialized = false
    this.ensureInitialized()
  }
}
