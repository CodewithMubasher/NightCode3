// ───────────────────────────────────────────────
// Bridge: converts NightCode formats → engine2 formats
// Allows the new engine to work with existing systems
// ───────────────────────────────────────────────

import type { Message, AIProvider } from "@/types"
import type { ToolImplementation } from "@/lib/engine/tools"
import { providerManager } from "./provider/manager"
import {
  type SessionMessage,
  type Tools,
  type ToolDef,
  type ProviderStreamFn,
  type SessionEvent,
  generateId,
} from "./index"

// ─── Message conversion: NightCode Message[] → SessionMessage[] ───
// Converts the content+toolStates format into parts-based format.
export function messagesToSessionMessages(msgs: Message[]): SessionMessage[] {
  return msgs.map((msg) => {
    const parts: SessionMessage["parts"] = []

    if (msg.content) {
      parts.push({ type: "text", id: generateId(), text: msg.content })
    }

    // Convert file attachments (images, PDFs) to image parts
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.type === "file" && att.data) {
          const mimeType = att.mediaType ?? att.contentType ?? "image/png"
          parts.push({ type: "image", id: generateId(), image: att.data, mimeType })
        } else if (att.type === "source-document" && att.url && att.url.startsWith("data:")) {
          const mimeType = att.mediaType ?? "application/octet-stream"
          const b64 = att.url.includes("base64,") ? att.url.split("base64,")[1] : att.url
          if (b64) parts.push({ type: "image", id: generateId(), image: b64, mimeType })
        }
      }
    }

    if (msg.reasoning) {
      parts.push({ type: "reasoning", id: generateId(), text: msg.reasoning })
    }

    for (const [key, state] of Object.entries(msg.toolStates ?? {})) {
      if (state.status === "running" || state.status === "skipped") continue
      const isError = state.status === "error" || state.status === "verification_failed"

      if (state.args && Object.keys(state.args).length > 0) {
        parts.push({
          type: "tool-call",
          id: generateId(),
          toolCallId: state.id,
          name: state.tool,
          input: state.args,
        })
      }

      if (isError && state.error) {
        parts.push({
          type: "tool-result",
          id: generateId(),
          toolCallId: state.id,
          name: state.tool,
          result: { type: "error", value: state.error },
        })
      } else if (state.result) {
        parts.push({
          type: "tool-result",
          id: generateId(),
          toolCallId: state.id,
          name: state.tool,
          result: { type: "json", value: state.result },
        })
      }
    }

    const role = msg.role === "system" ? "system"
      : msg.role === "assistant" ? "assistant"
      : "user"

    return { role, parts } as SessionMessage
  })
}

// ─── Tool conversion: ToolImplementation[] → Tools ───
export function toolsToRecord(implementations: ToolImplementation[]): Tools {
  const result: Tools = {}

  for (const impl of implementations) {
    const def: ToolDef = {
      name: impl.name,
      description: impl.description,
      inputSchema: impl.schema as Record<string, unknown>,
      execute: async (params: unknown) => {
        try {
          const rawResult = await impl.execute(params as Record<string, unknown>)
          return { success: rawResult.success, data: rawResult.data, error: rawResult.error }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }

    result[impl.name] = def
  }

  return result
}

// ─── Provider wrapper: uses ProviderManager (key-pool, retry, health) ───
export function createProviderStreamFn(
  provider: AIProvider,
  modelId: string,
): ProviderStreamFn {
  return async (messages, system, tools, callbacks, signal) => {
    const result = await providerManager.stream({
      messages: messages as Array<{ role: string; content: unknown }>,
      provider,
      model: modelId,
      tools: tools?.map((t) => ({
        name: t.name,
        description: t.description,
        schema: t.inputSchema as Record<string, unknown>,
      })),
      systemPrompt: system,
      onText: callbacks?.onText,
      onReasoning: callbacks?.onReasoning,
      signal,
    })

    if (!result.success) {
      throw new Error(`Provider stream failed: ${result.error}`)
    }

    return {
      text: result.value.text,
      reasoning: result.value.reasoning,
      toolCalls: result.value.toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args,
      })),
      usage: result.value.usage,
    }
  }
}
