// ───────────────────────────────────────────────
// LLM Adapter — converts provider stream callbacks
// into LLMEvent stream (matching opencode's ai-sdk.ts)
// ───────────────────────────────────────────────

import {
  type LLMEvent,
  type ContentBlockID,
  type ToolCallID,
  type ProviderMessage,
  type ToolDefinition,
  type ProviderStreamFn,
  createContentBlockId,
  createToolCallId,
} from "./types"

export interface AdapterCallbacks {
  onEvent: (event: LLMEvent) => void
  onError: (error: Error) => void
  onDone: () => void
}

export interface AdapterOptions {
  messages: ProviderMessage[]
  system?: string
  tools?: ToolDefinition[]
  signal?: AbortSignal
  onEvent: (event: LLMEvent) => void
}

export interface LLMAdapter {
  stream(options: AdapterOptions): Promise<void>
}

// ─── Concrete: wraps a callback-based LLM provider ───
// Converts onText / onReasoning / final tool calls → LLMEvent stream.
// Matches opencode's "stream" which produces LLMEvent-typed chunks.

export function createAdapter(providerStream: ProviderStreamFn): LLMAdapter {
  return {
    async stream(options: AdapterOptions): Promise<void> {
      const { messages, system, tools, signal, onEvent: emit } = options

      // Emit step-start
      emit({ type: "step-start", index: 0 })

      const textBlockId = createContentBlockId()
      const reasoningBlockId = createContentBlockId()
      let hasReasoning = false
      let hasText = false

      const callbacks = {
        onText: (text: string) => {
          if (!hasText) {
            hasText = true
            emit({ type: "text-start", id: textBlockId })
          }
          emit({ type: "text-delta", id: textBlockId, text })
        },
        onReasoning: (text: string) => {
          if (!hasReasoning) {
            hasReasoning = true
            emit({ type: "reasoning-start", id: reasoningBlockId })
          }
          emit({ type: "reasoning-delta", id: reasoningBlockId, text })
        },
      }

      try {
        const result = await providerStream(messages, system, tools, callbacks, signal)

        if (hasText) {
          emit({ type: "text-end", id: textBlockId })
        }
        if (hasReasoning) {
          emit({ type: "reasoning-end", id: reasoningBlockId })
        }

        // Emit tool call events
        if (result.toolCalls.length > 0) {
          console.log(`[adapter] Tool calls from provider:`, result.toolCalls.map(tc => ({
            name: tc.toolName,
            argsType: typeof tc.args,
            argsNull: tc.args === null,
            argsKeys: tc.args ? Object.keys(tc.args) : [],
          })))
        }
        for (const tc of result.toolCalls) {
          const callId = createToolCallId()
          const safeArgs = tc.args ?? {}
          emit({
            type: "tool-input-start",
            id: callId,
            name: tc.toolName,
          })
          emit({
            type: "tool-input-delta",
            id: callId,
            name: tc.toolName,
            text: JSON.stringify(safeArgs),
          })
          emit({
            type: "tool-input-end",
            id: callId,
            name: tc.toolName,
          })
          emit({
            type: "tool-call",
            id: callId,
            name: tc.toolName,
            input: safeArgs,
          })
        }

        // Emit step-finish + finish
        // Some providers return "stop" even when tool calls are present.
        // Always check toolCalls first, fall back to provider's finish_reason.
        const reason =
          result.toolCalls.length > 0 ? "tool-calls"
          : result.finishReason === "tool_calls" ? "tool-calls"
          : "stop"

        emit({
          type: "step-finish",
          index: 0,
          reason,
          usage: result.usage
            ? {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                reasoningTokens: result.usage.reasoningTokens,
              }
            : undefined,
        })

        emit({
          type: "finish",
          reason,
          usage: result.usage
            ? {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                reasoningTokens: result.usage.reasoningTokens,
              }
            : undefined,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit({ type: "provider-error", message })
        throw err
      }
    },
  }
}
