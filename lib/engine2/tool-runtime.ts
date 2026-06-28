// ───────────────────────────────────────────────
// Port of opencode's tool-runtime.ts
// Dispatch tool calls → execute → encode → events
// ───────────────────────────────────────────────

import {
  type LLMEvent,
  type ToolCallPart,
  type ToolResultValue,
  type Tools,
  createToolCallId,
  makeToolResultValue,
} from "./types"
import type { SessionCache } from "./cache/session-cache"

export interface DispatchResult {
  result: ToolResultValue
  events: LLMEvent[]
  textOutput: string
  /** True if result came from cache (tool never executed) */
  cached: boolean
  /** Execution time in ms */
  latencyMs: number
}

export async function dispatchTool(
  tools: Tools,
  call: ToolCallPart,
  cache?: SessionCache,
): Promise<DispatchResult> {
  const tool = tools[call.name]

    if (!tool) {
      return { ...errorResult(call, `Unknown tool: ${call.name}`), cached: false, latencyMs: 0, textOutput: "" }
    }

    if (!tool.execute) {
      return { ...errorResult(call, `Tool has no execute handler: ${call.name}`), cached: false, latencyMs: 0, textOutput: "" }
    }

  // ── Check cache first ──────────────────────────────
  if (cache) {
    const cached = await cache.get(call.name, call.input as Record<string, unknown>)
    if (cached) {
      const value = cached.value as ToolResultValue
      const textOutput = value.type === "error"
        ? String(value.value)
        : value.type === "content"
          ? String(value.value)
          : value.type === "json"
            ? JSON.stringify(value.value, null, 2)
            : String(value.value)

      return {
        result: value,
        textOutput,
        cached: true,
        latencyMs: 0,
        events: [
          {
            type: "tool-result",
            id: call.toolCallId,
            name: call.name,
            result: value,
          },
        ],
      }
    }
  }

  const startTime = Date.now()
  const TOOL_TIMEOUT_MS = 30_000
  try {
    const rawResult = await Promise.race([
      tool.execute(call.input, { id: call.toolCallId, name: call.name }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error(`Tool "${call.name}" timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS)
        if (typeof timer === "object" && timer !== null) {
          const t = timer as { unref?: () => void }; t.unref?.()
        }
      }),
    ]) as Awaited<ReturnType<typeof tool.execute>>

    let result: ToolResultValue

    if (!rawResult.success) {
      const errorMsg = rawResult.error ?? "Tool execution failed"
      result = { type: "error", value: errorMsg }

      // Don't cache errors
      return {
        result,
        textOutput: errorMsg,
        cached: false,
        latencyMs: Date.now() - startTime,
        events: [
          {
            type: "tool-error",
            id: call.toolCallId,
            name: call.name,
            message: errorMsg,
          },
        ],
      }
    }

    // Encode result via toModelOutput if available
    let output: ToolResultValue
    const textOutput = typeof rawResult.data === "string"
      ? rawResult.data
      : JSON.stringify(rawResult.data, null, 2)

    if (tool.toModelOutput) {
      const content = tool.toModelOutput({
        callID: call.toolCallId,
        parameters: call.input,
        output: rawResult.data,
      })
      output = { type: "content", value: content }
    } else {
      output = makeToolResultValue(rawResult.data)
    }

    // Store in cache (skip errors)
    if (cache) {
      cache.set(call.name, call.input as Record<string, unknown>, {
        value: output,
        resultType: output.type,
        cachedAt: Date.now(),
      })
    }

    return {
      result: output,
      textOutput,
      cached: false,
      latencyMs: Date.now() - startTime,
      events: [
        {
          type: "tool-result",
          id: call.toolCallId,
          name: call.name,
          result: output,
        },
      ],
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return errorResult(call, errorMsg)
  }
}

function errorResult(call: ToolCallPart, message: string): DispatchResult {
  return {
    result: { type: "error", value: message },
    textOutput: message,
    cached: false,
    latencyMs: 0,
    events: [
      {
        type: "tool-error",
        id: call.toolCallId,
        name: call.name,
        message,
      },
    ],
  }
}

// ─── Parallel tool dispatch ─────────────────────
export async function dispatchTools(
  tools: Tools,
  calls: ToolCallPart[],
  cache?: SessionCache,
): Promise<DispatchResult[]> {
  return await Promise.all(
    calls.map((call) => dispatchTool(tools, call, cache)),
  )
}
