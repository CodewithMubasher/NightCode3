import { PROVIDER_CONFIGS, OPENAI_COMPATIBLE } from "./types"
import type { KeyHealth } from "./key-pool"

export type RetryResult<T> = {
  success: true
  value: T
  keyUsed: string
  latencyMs: number
} | {
  success: false
  error: string
  keyUsed?: string
}

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  timeoutMs?: number
  signal?: AbortSignal
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403
}

export async function withRetry<T>(
  fn: (key: KeyHealth, signal: AbortSignal) => Promise<{ data: T; status: number; latencyMs: number }>,
  getKeys: () => KeyHealth[],
  reportSuccess: (keyValue: string, tokens: number, latencyMs: number) => void,
  reportFailure: (keyValue: string, status: number, penaltyMs?: number) => void,
  options?: RetryOptions,
): Promise<RetryResult<T>> {
  const { maxRetries = 3, baseDelayMs = 1000, timeoutMs = 30_000, signal: userSignal } = options ?? {}
  const startTime = Date.now()
  let lastError = ""

  // If user cancelled before we even start, bail immediately
  if (userSignal?.aborted) {
    return { success: false, error: "Aborted" }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check user cancel before each attempt
    if (userSignal?.aborted) {
      return { success: false, error: "Aborted" }
    }

    const keys = getKeys()
    if (keys.length === 0) {
      return { success: false, error: "No available keys for this provider" }
    }

    // Try each key in order (they should be sorted by healthiest-first)
    for (const key of keys) {
      if (userSignal?.aborted) return { success: false, error: "Aborted" }
      if (key.status === "dead") continue
      if (key.cooldownUntil > Date.now() && key.status === "cooldown") continue

      try {
        const timeoutController = new AbortController()
        const timeout = setTimeout(() => timeoutController.abort(), timeoutMs)

        // Race: user abort, timeout abort, or the actual request
        const combinedSignal = userSignal
          ? combineSignals([userSignal, timeoutController.signal])
          : timeoutController.signal

        const result = await fn(key, combinedSignal)
        clearTimeout(timeout)

        const latencyMs = Date.now() - startTime
        const usage = result.data && typeof result.data === "object"
          ? (result.data as any).usage as { inputTokens?: number; outputTokens?: number } | undefined
          : undefined
        const tokens = usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : 0

        reportSuccess(key.slot.value, tokens, latencyMs)

        return {
          success: true,
          value: result.data,
          keyUsed: key.label,
          latencyMs,
        }
      } catch (err: any) {
        const status = err?.status ?? err?.statusCode ?? 0
        const message = err?.message ?? String(err)
        lastError = message

        if (err?.name === "AbortError") {
          reportFailure(key.slot.value, 408, 5_000) // timeout
          continue
        }

        if (isAuthFailure(status)) {
          reportFailure(key.slot.value, status, 24 * 60 * 60 * 1000)
          continue
        }

        if (isRetryable(status)) {
          const backoff = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500
          reportFailure(key.slot.value, status, Math.round(backoff))
          await sleep(backoff)
          continue
        }

        // Non-retryable (400, 404, 413, etc.)
        reportFailure(key.slot.value, status, 30_000)
        return { success: false, error: message, keyUsed: key.label }
      }
    }

    // All keys exhausted for this attempt — wait and retry
    if (attempt < maxRetries) {
      if (userSignal?.aborted) return { success: false, error: "Aborted" }
      const backoff = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000
      await sleep(backoff)
    }
  }

  return { success: false, error: lastError || "All retries exhausted" }
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) { controller.abort(s.reason); return controller.signal }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
