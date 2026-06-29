import { KeyPool, type KeyHealth } from "./key-pool"
import { HealthMonitor } from "./health-monitor"
import { withRetry, type RetryResult } from "./retry-handler"
import { PROVIDER_CONFIGS, OPENAI_COMPATIBLE, getBaseUrl } from "./types"
import { streamOpenAI } from "@/lib/engine/providers/openai"
import { streamGoogle } from "@/lib/engine/providers/google"
import { streamOllama } from "@/lib/engine/providers/ollama"
import { streamLocal } from "@/lib/engine/providers/local"
import type { StreamResult } from "@/lib/engine/providers/common"

export interface StreamRequest {
  messages: Array<{ role: string; content: unknown }>
  provider: string
  model: string
  tools?: Array<{ name: string; description: string; schema: Record<string, unknown> }>
  systemPrompt?: string
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  onToolCallStart?: (toolCallId: string, name: string) => void
  onToolCallDelta?: (toolCallId: string, text: string) => void
  signal?: AbortSignal
}

export class ProviderManager {
  readonly keyPool = new KeyPool()
  readonly healthMonitor = new HealthMonitor()

  constructor() {
    this.healthMonitor.startPeriodicChecks(() => this.getAllKeys())
  }

  async stream(request: StreamRequest): Promise<RetryResult<StreamResult>> {
    const { provider, model, messages, tools, systemPrompt, onText, onReasoning, onToolCallStart, onToolCallDelta, signal } = request

    const result = await withRetry(
      async (key: KeyHealth, retrySignal: AbortSignal) => {
        const headers = this.buildHeaders(key)
        const url = getBaseUrl(provider, model, key.slot.value)
        const gatewayCallbacks = { onText, onReasoning, onToolCallStart, onToolCallDelta }

        let streamResult: StreamResult

        if (provider === "local") {
          const rawTools = tools?.map((t) => ({
            name: t.name,
            description: t.description,
            schema: t.schema as Record<string, string | any>,
          }))
          streamResult = await streamLocal(
            messages, model, gatewayCallbacks, headers, url,
            undefined, rawTools, retrySignal,
          )
        } else if (provider === "google") {
          const rawTools = tools?.map((t) => ({
            name: t.name,
            description: t.description,
            schema: t.schema as Record<string, string | any>,
          }))
          streamResult = await streamGoogle(
            messages, model, rawTools, systemPrompt,
            gatewayCallbacks, headers, key.slot, retrySignal,
          )
        } else if (OPENAI_COMPATIBLE.has(provider)) {
          const rawTools = tools?.map((t) => ({
            name: t.name,
            description: t.description,
            schema: t.schema as Record<string, string | any>,
          }))
          streamResult = await streamOpenAI(
            messages, model, systemPrompt, rawTools,
            gatewayCallbacks, headers, url, retrySignal,
          )
        } else if (provider === "ollama") {
          streamResult = await streamOllama(
            messages, model, gatewayCallbacks, headers, url, retrySignal,
          )
        } else {
          throw new Error(`Unknown provider: ${provider}`)
        }

        // Extract HTTP status from the stream response
        const status = 200 // providers throw on non-200

        return {
          data: streamResult,
          status,
          latencyMs: 0,
        }
      },
      () => {
        const best = this.keyPool.getHealthiest(provider)
        return best ? [best] : []
      },
      (keyValue, tokens, latencyMs) => this.keyPool.reportSuccess(provider, keyValue, tokens, latencyMs),
      (keyValue, status, penaltyMs) => this.keyPool.reportFailure(provider, keyValue, status, penaltyMs),
      {
        timeoutMs: PROVIDER_CONFIGS[provider]?.timeoutMs ?? 30_000,
        baseDelayMs: 1000,
        maxRetries: 3,
        signal,
      },
    )

    return result
  }

  /** Returns all provider names that have at least one usable key. */
  getAvailableProviders(): string[] {
    return this.keyPool.getAvailableProviders()
  }

  /** Returns recommended keys sorted by remaining capacity. */
  getRecommended(): Array<{ provider: string; remaining: number; label: string }> {
    return this.keyPool.getRecommendedKeys().map(({ provider, key, remaining }) => ({
      provider,
      remaining,
      label: key.label,
    }))
  }

  /** Returns health report for display. */
  getHealthReport(): Array<{ provider: string; healthy: number; total: number; dead: number; avgLatencyMs: number | null }> {
    const reports: Array<{ provider: string; healthy: number; total: number; dead: number; avgLatencyMs: number | null }> = []

    for (const [providerName, cfg] of Object.entries(PROVIDER_CONFIGS)) {
      const keys = this.keyPool.getKeys(providerName)
      if (keys.length === 0) continue
      const report = this.healthMonitor.getReport(providerName, keys)
      reports.push({
        provider: report.provider,
        healthy: report.healthyKeys,
        total: report.totalKeys,
        dead: report.deadKeys,
        avgLatencyMs: report.avgLatencyMs,
      })
    }

    return reports
  }

  reloadKeys(): void {
    this.keyPool.reloadKeys()
  }

  private buildHeaders(key: KeyHealth): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (key.slot.provider === "local") return headers
    if (key.slot.provider === "google") {
      headers["x-goog-api-key"] = key.slot.value
    } else {
      headers["Authorization"] = `Bearer ${key.slot.value}`
    }

    return headers
  }

  private getAllKeys(): Map<string, KeyHealth[]> {
    const all = new Map<string, KeyHealth[]>()
    for (const providerName of Object.keys(PROVIDER_CONFIGS)) {
      const keys = this.keyPool.getKeys(providerName)
      if (keys.length > 0) all.set(providerName, keys)
    }
    return all
  }
}

export const providerManager = new ProviderManager()
