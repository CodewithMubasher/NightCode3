import type { ToolImplementation } from "./tools"
import { streamChat, type UsageInfo, type StreamResult } from "./gateway"

export type { UsageInfo }

export type StepResult =
  | { type: "text"; content: string; reasoning?: string; usage?: UsageInfo }
  | { type: "tool_calls"; text: string; reasoning?: string; toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>; usage?: UsageInfo }

export type PlannerCallbacks = {
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
}

// ─── Single-step planner ───────────────────────────────────────────────────────
// Calls the gateway's streamChat which handles all provider-specific logic.
// The gateway returns parsed text, reasoning, and tool calls.

export async function planStep(
  messages: Array<{ role: string; content: unknown }>,
  provider: string,
  modelId: string,
  availableTools: ToolImplementation[],
  callbacks: PlannerCallbacks,
  signal?: AbortSignal,
  systemPrompt?: string
): Promise<StepResult> {
  const sanitizeText = makeTextSanitizer()

  const wrappedCallbacks: PlannerCallbacks = {
    ...callbacks,
    onText: callbacks.onText ? (text: string) => {
      const safe = sanitizeText(text)
      if (safe) callbacks.onText!(safe)
    } : undefined,
  }

  // Retry helper with exponential backoff
  async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; baseDelayMs?: number; signal?: AbortSignal } = {}
  ): Promise<T> {
    const { maxRetries = 3, baseDelayMs = 1000 } = options
    let lastErr: Error | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        console.log(`[planner] Retry attempt ${attempt}/${maxRetries} after ${delay}ms`)
        await new Promise((r) => {
          const timer = setTimeout(r, delay)
          if (signal) {
            signal.addEventListener("abort", () => { clearTimeout(timer); r(undefined) }, { once: true })
          }
        })
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      }
      try {
        return await fn()
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
        const status = (err as any)?.status ?? 0
        if (status && status !== 429 && status < 500) throw lastErr
        if (attempt >= maxRetries) throw lastErr
      }
    }
    throw lastErr ?? new Error("Retry failed")
  }

  async function doStreamText(): Promise<StreamResult> {
    // Convert ToolImplementation[] → gateway tool format (schema strings only)
    const tools = availableTools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: Object.entries(t.schema).reduce((acc, [key, val]) => {
        acc[key] = typeof val === "string" ? val : typeof val
        return acc
      }, {} as Record<string, string>),
    }))

    const result = await streamChat(
      messages,
      provider,
      modelId,
      tools,
      systemPrompt,
      wrappedCallbacks,
      signal,
    )

    return result
  }

  try {
    const result = await retryWithBackoff(doStreamText, { signal })

    if (result.toolCalls.length > 0) {
      return { type: "tool_calls", text: result.text, reasoning: result.reasoning, toolCalls: result.toolCalls, usage: result.usage }
    }

    return { type: "text", content: result.text, reasoning: result.reasoning, usage: result.usage }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    const cause = (err as any)?.cause
    console.error(
      `[planner] Tool calling failed: ${msg}.` +
      (cause ? ` Cause: ${cause instanceof Error ? cause.message : JSON.stringify(cause)}.` : "") +
      ` Retrying without tools.`
    )

    // Fallback: text-only request (no tools)
    const textOnlyMessages = messages.filter((m) => m.role !== "tool").map((m) => {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const textParts = (m.content as Array<{ type: string; text?: string }>).filter((p) => p.type === "text")
        const combined = textParts.map((p) => p.text ?? "").join("")
        return { role: "assistant", content: combined }
      }
      return m
    })

    const wrappedFallbackCallbacks: PlannerCallbacks = {
      ...callbacks,
      onText: callbacks.onText ? (text: string) => {
        const safe = sanitizeText(text)
        if (safe) callbacks.onText!(safe)
      } : undefined,
    }

    async function doFallbackText(): Promise<StreamResult> {
      return await streamChat(textOnlyMessages, provider, modelId, undefined, systemPrompt, wrappedFallbackCallbacks, signal)
    }

    try {
      const fallbackResult = await retryWithBackoff(doFallbackText, { signal })
      return { type: "text", content: fallbackResult.text, reasoning: fallbackResult.reasoning, usage: fallbackResult.usage }
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error"
      console.error(`[planner] Fallback also failed: ${fallbackMsg}`)
      return { type: "text", content: `LLM request failed: ${fallbackMsg}` }
    }
  }
}

function makeTextSanitizer() {
  let buffer = ""
  let insideJsonBlock = false

  return function sanitize(chunk: string): string {
    buffer += chunk

    if (!insideJsonBlock && buffer.includes("```json")) {
      insideJsonBlock = true
    }

    if (insideJsonBlock) {
      if (buffer.includes("```json") && buffer.includes("```")) {
        const lastClose = buffer.lastIndexOf("```")
        const firstOpen = buffer.indexOf("```json")
        if (lastClose > firstOpen) {
          buffer = buffer.slice(0, firstOpen) + buffer.slice(lastClose + 3)
          insideJsonBlock = false
        }
      }
      const clean = buffer
        .replace(/```json[\s\S]*?```/g, "")
        .trim()
      buffer = clean
      return ""
    }

    const cleaned = buffer
    buffer = ""
    return cleaned
  }
}
