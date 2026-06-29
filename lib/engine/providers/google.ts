import type { GatewayCallbacks, StreamResult, ToolDef, UsageInfo } from "./common"
import { schemaValueToJsonSchema } from "./common"
import { getTemperature, ApiError } from "./common"

async function parseGeminiStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  callbacks: GatewayCallbacks,
): Promise<{ text: string; reasoning: string; toolCalls: StreamResult["toolCalls"]; usage?: UsageInfo }> {
  const decoder = new TextDecoder()
  let buffer = ""
  let collectedText = ""
  let collectedReasoning = ""
  const collectedToolCalls: StreamResult["toolCalls"] = []
  let usage: UsageInfo | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === "data: [DONE]") continue
      if (!trimmed.startsWith("data: ")) continue

      try {
        const json = JSON.parse(trimmed.slice(6))
        const candidates = json.candidates ?? []
        if (candidates.length === 0) continue

        const parts = candidates[0]?.content?.parts ?? []

        for (const part of parts) {
          if (part.text) {
            callbacks.onText?.(part.text)
            collectedText += part.text
          }

          if (part.thoughtSummary || part.thought) {
            const t = part.thoughtSummary ?? part.thought
            if (typeof t === "string") {
              callbacks.onReasoning?.(t)
              collectedReasoning += t
            }
          }

          if (part.functionCall) {
            const name = part.functionCall.name
            const rawArgs = part.functionCall.args
            // Gemini returns args either as a parsed object or a JSON string.
            let args: Record<string, unknown> = {}
            if (rawArgs && typeof rawArgs === "object") {
              args = rawArgs as Record<string, unknown>
            } else if (typeof rawArgs === "string") {
              try { args = JSON.parse(rawArgs) } catch { args = { _raw: rawArgs } }
            }
            const uniqueId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            callbacks.onToolCallStart?.(uniqueId, name)
            callbacks.onToolCallDelta?.(uniqueId, JSON.stringify(args))
            collectedToolCalls.push({
              toolCallId: uniqueId,
              toolName: name,
              args,
            })
          }
        }

        if (json.usageMetadata) {
          usage = {
            inputTokens: json.usageMetadata.promptTokenCount ?? 0,
            outputTokens: json.usageMetadata.candidatesTokenCount ?? 0,
            reasoningTokens: json.usageMetadata.thoughtsTokenCount ?? undefined,
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  return { text: collectedText, reasoning: collectedReasoning, toolCalls: collectedToolCalls, usage }
}

function buildGeminiTools(tools: ToolDef[]): unknown[] {
  return [{
    functionDeclarations: tools.map((t) => {
      const entries = Object.entries(t.schema)
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const [key, value] of entries) {
        const prop = schemaValueToJsonSchema(value)
        // Gemini uses "nullable" instead of "optional"
        if (prop.optional === true) {
          prop.nullable = true
          delete prop.optional
        }
        properties[key] = prop

        const isOptional =
          (typeof value === "string" && value.endsWith("?")) ||
          (value && typeof value === "object" && "_def" in value &&
            ((value as any)._def?.type === "optional" || (value as any)._def?.type === "nullable"))

        if (!isOptional) {
          required.push(key)
        }
      }

      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
      }
    }),
  }]
}

/**
 * Convert a tool-result `output` ({type:"json", value}) into a plain JSON-serializable
 * object Gemini can store inside functionResponse.response.
 */
function toolOutputToResponse(output: unknown): Record<string, unknown> {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const o = output as Record<string, unknown>
    // engine wraps results as { type: "json", value: <data> }
    if (o.type === "json" && "value" in o) {
      const v = o.value
      if (v && typeof v === "object") return v as Record<string, unknown>
      return { result: v }
    }
    return o
  }
  if (typeof output === "string") {
    try { return JSON.parse(output) } catch { return { result: output } }
  }
  return { result: output }
}

/**
 * Build the Gemini `contents` array from the engine's normalized message list.
 *
 * CRITICAL: Gemini requires strict pairing:
 *   model turn  -> contains functionCall parts (what the model wanted to do)
 *   user turn   -> contains functionResponse parts (what the tools returned)
 *
 * The engine encodes assistant turns as content arrays of:
 *   { type: "text", text } | { type: "tool-call", toolCallId, toolName, input }
 * and tool results as role:"tool" with content [{ type: "tool-result", toolCallId, toolName, output }].
 */
function buildGeminiContents(
  messages: Array<{ role: string; content: unknown }>,
): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  const out: Array<{ role: string; parts: Array<Record<string, unknown>> }> = []

  for (const m of messages) {
    // ── Tool result message ────────────────────────────────────────────────
    // Engine shape: { role: "tool", content: [{ type:"tool-result", toolCallId, toolName, output }] }
    if (m.role === "tool") {
      const parts: Array<Record<string, unknown>> = []
      const items = Array.isArray(m.content) ? m.content : [m.content]
      for (const part of items as Array<Record<string, unknown>>) {
        const p = part as Record<string, unknown>
        if (p?.type === "tool-result") {
          parts.push({
            functionResponse: {
              name: p.toolName,
              response: toolOutputToResponse(p.output),
            },
          })
        } else if (typeof p === "object" && p !== null && p.text) {
          parts.push({ text: String(p.text) })
        }
      }
      if (parts.length > 0) out.push({ role: "user", parts })
      continue
    }

    // ── Assistant / model turn ─────────────────────────────────────────────
    if (m.role === "assistant") {
      const parts: Array<Record<string, unknown>> = []
      if (typeof m.content === "string") {
        if (m.content.trim()) parts.push({ text: m.content })
      } else if (Array.isArray(m.content)) {
        for (const raw of m.content as Array<Record<string, unknown>>) {
          const p = raw as Record<string, unknown>
          if (p?.type === "text" && typeof p.text === "string" && p.text.trim()) {
            parts.push({ text: p.text })
          } else if (p?.type === "tool-call") {
            // Echo the function call back so Gemini can pair it with the response.
            parts.push({
              functionCall: {
                name: p.toolName,
                args: (p.input ?? {}) as Record<string, unknown>,
              },
            })
          }
        }
      }
      if (parts.length > 0) out.push({ role: "model", parts })
      continue
    }

    // ── User / system-as-user turn ─────────────────────────────────────────
    if (typeof m.content === "string") {
      if (m.content.trim()) out.push({ role: "user", parts: [{ text: m.content }] })
    } else if (Array.isArray(m.content)) {
      const parts: Array<Record<string, unknown>> = []
      for (const raw of m.content as Array<Record<string, unknown>>) {
        const p = raw as Record<string, unknown>
        if (p?.type === "text" && typeof p.text === "string") {
          parts.push({ text: p.text })
        } else if (p?.type === "image") {
          parts.push({ inlineData: { mimeType: p.mimeType ?? "image/png", data: p.image } })
        } else if (p?.type === "file") {
          parts.push({ inlineData: { mimeType: p.mimeType ?? "application/pdf", data: p.data } })
        }
      }
      if (parts.length > 0) out.push({ role: "user", parts })
    }
  }

  return out
}

export async function streamGoogle(
  messages: Array<{ role: string; content: unknown }>,
  model: string,
  tools: ToolDef[] | undefined,
  systemPrompt: string | undefined,
  callbacks: GatewayCallbacks,
  headers: Record<string, string>,
  keySlot: { value: string; type: string },
  signal?: AbortSignal,
): Promise<StreamResult> {
  let url: string
  if (keySlot.type === "API_KEY") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${keySlot.value}`
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
  }

  const geminiMessages = buildGeminiContents(messages)

  const body: Record<string, unknown> = {
    contents: geminiMessages,
  }

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  if (tools && tools.length > 0) {
    body.tools = buildGeminiTools(tools)
  }

  const temp = getTemperature(model)
  if (temp !== undefined) {
    body.generationConfig = { temperature: temp }
  }

  const timeoutSignal = AbortSignal.timeout(120_000)
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new ApiError(res.status, `Gemini API error ${res.status}: ${errText.slice(0, 300)}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response body")

  return await parseGeminiStream(reader, signal ?? new AbortController().signal, callbacks)
}
