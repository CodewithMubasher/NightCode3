import type { GatewayCallbacks, StreamResult, ToolDef, UsageInfo } from "./common"
import { buildToolsArray, getTemperature, getModelParam, formatOpenAIMessages, extractInlineToolCalls, ApiError } from "./common"

async function parseOpenAIStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  callbacks: GatewayCallbacks,
): Promise<{ text: string; reasoning: string; toolCalls: StreamResult["toolCalls"]; usage?: UsageInfo }> {
  const decoder = new TextDecoder()
  let buffer = ""
    let collectedText = ""
    let collectedReasoning = ""
    const collectedToolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> | null }> = []
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
          const choices = json.choices ?? []

          if (choices.length > 0 && choices[0].message?.content && !choices[0].delta) {
            const msg = choices[0].message
            if (msg.content) {
              callbacks.onText?.(msg.content)
              collectedText += msg.content
            }
          }

          for (const choice of choices) {
            const delta = choice.delta ?? {}

            if (delta.content) {
              callbacks.onText?.(delta.content)
              collectedText += delta.content
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  collectedToolCalls.push({
                    toolCallId: tc.id ?? `call_${Date.now()}`,
                    toolName: tc.function.name,
                    args: {},
                  })
                }
                if (tc.function?.arguments && collectedToolCalls.length > 0) {
                  const last = collectedToolCalls[collectedToolCalls.length - 1]
                  try {
                    const parsed = JSON.parse(tc.function.arguments)
                    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                      last.args = { ...last.args, ...parsed }
                    } else {
                      last.args = null
                    }
                  } catch {
                    last.args = null
                  }
                }
              }
            }
          }

          if (json.usage) {
            usage = {
              inputTokens: json.usage.prompt_tokens ?? json.usage.inputTokens ?? 0,
              outputTokens: json.usage.completion_tokens ?? json.usage.outputTokens ?? 0,
              reasoningTokens: json.usage.reasoning_tokens ?? undefined,
            }
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

  if (collectedToolCalls.length === 0) {
    const inlineCalls = extractInlineToolCalls(collectedText)
    collectedToolCalls.push(...inlineCalls)
    if (inlineCalls.length > 0) {
      collectedText = ""
    }
  }

  return { text: collectedText, reasoning: collectedReasoning, toolCalls: collectedToolCalls as StreamResult["toolCalls"], usage }
}

export async function streamOpenAI(
  messages: Array<{ role: string; content: unknown }>,
  model: string,
  systemPrompt: string | undefined,
  tools: ToolDef[] | undefined,
  callbacks: GatewayCallbacks,
  headers: Record<string, string>,
  url: string,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const body: Record<string, unknown> = {
    model: getModelParam("openai", model),
    messages: formatOpenAIMessages(messages),
    stream: true,
    temperature: getTemperature(model),
  }

  if (systemPrompt) {
    body.messages = [{ role: "system", content: systemPrompt }, ...(body.messages as any[])]
  }

  if (tools && tools.length > 0) {
    body.tools = buildToolsArray(tools)
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new ApiError(res.status, `API error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response body")

  return await parseOpenAIStream(reader, signal ?? new AbortController().signal, callbacks)
}
