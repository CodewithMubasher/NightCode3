import type { GatewayCallbacks, StreamResult, ToolDef, UsageInfo } from "./common"
import { buildToolsArray, getTemperature, getModelParam, formatOpenAIMessages, extractInlineToolCalls, ApiError } from "./common"

interface PendingTool {
  toolCallId: string
  toolName: string
  input: string
}

async function parseOpenAIStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  callbacks: GatewayCallbacks,
): Promise<{ text: string; reasoning: string; toolCalls: StreamResult["toolCalls"]; finishReason?: string; usage?: UsageInfo }> {
  const decoder = new TextDecoder()
  let buffer = ""
  let collectedText = ""
  let collectedReasoning = ""

  // ToolStream: track pending tool calls by index from delta.tool_calls[].index
  const toolStream = new Map<number, PendingTool>()
  let finishReason: string | undefined
  let gotNonDeltaToolCalls = false

  // Final collected tool calls
  const finalToolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> | null }> = []
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

        // Non-delta message chunks — some providers send tool calls as message, not delta
        if (choices.length > 0 && !choices[0].delta) {
          const msg = choices[0].message
          if (msg?.tool_calls) {
            gotNonDeltaToolCalls = true
            for (const tc of msg.tool_calls) {
              if (tc.function?.name) {
                let args: Record<string, unknown> = {}
                if (typeof tc.function.arguments === "string") {
                  try { args = JSON.parse(tc.function.arguments) } catch {}
                } else if (typeof tc.function.arguments === "object" && tc.function.arguments !== null) {
                  args = tc.function.arguments as Record<string, unknown>
                }
                finalToolCalls.push({
                  toolCallId: tc.id ?? `call_${Date.now()}`,
                  toolName: tc.function.name,
                  args,
                })
              }
            }
          } else if (msg?.content) {
            callbacks.onText?.(msg.content)
            collectedText += msg.content
          }
          if (choices[0].finish_reason) {
            finishReason = choices[0].finish_reason
          }
        }

        for (const choice of choices) {
          const delta = choice.delta ?? {}

          if (delta.content) {
            callbacks.onText?.(delta.content)
            collectedText += delta.content
          }

          // Track finish_reason from the provider
          if (choice.finish_reason) {
            finishReason = choice.finish_reason
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? toolStream.size
              const existing = toolStream.get(index)

              // First delta for this index → start new tool (appendOrStart)
              if (!existing && tc.function?.name) {
                toolStream.set(index, {
                  toolCallId: tc.id ?? `call_${Date.now()}`,
                  toolName: tc.function.name,
                  input: "",
                })
              }

              // Append argument text across chunks (accumulate, don't parse yet)
              const current = toolStream.get(index)
              if (current && tc.function?.arguments) {
                if (typeof tc.function.arguments === "string") {
                  current.input += tc.function.arguments
                } else if (typeof tc.function.arguments === "object" && tc.function.arguments !== null) {
                  // Provider pre-parsed the JSON — finalize immediately
                  current.input = ""
                  finalToolCalls.push({
                    toolCallId: current.toolCallId,
                    toolName: current.toolName,
                    args: tc.function.arguments as Record<string, unknown>,
                  })
                  toolStream.delete(index)
                }
              }
            }
          }
        }

        // finish_reason with pending tools → finishAll: parse accumulated JSON
        if (finishReason && toolStream.size > 0) {
          for (const [, pending] of toolStream) {
            if (pending.input) {
              try {
                const parsed = JSON.parse(pending.input)
                if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                  finalToolCalls.push({
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    args: parsed as Record<string, unknown>,
                  })
                } else {
                  finalToolCalls.push({
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    args: {},
                  })
                }
              } catch {
                finalToolCalls.push({
                  toolCallId: pending.toolCallId,
                  toolName: pending.toolName,
                  args: {},
                })
              }
            } else if (!finalToolCalls.some(tc => tc.toolCallId === pending.toolCallId)) {
              // Tool with no arg text accumulated — still finalize with empty args
              finalToolCalls.push({
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                args: {},
              })
            }
          }
          toolStream.clear()
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

  // Finalize any remaining un-finalized tool calls (stream ended without finish_reason)
  if (toolStream.size > 0) {
    for (const [, pending] of toolStream) {
      if (pending.input) {
        try {
          const parsed = JSON.parse(pending.input)
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            finalToolCalls.push({
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              args: parsed as Record<string, unknown>,
            })
          } else {
            finalToolCalls.push({ toolCallId: pending.toolCallId, toolName: pending.toolName, args: {} })
          }
        } catch {
          finalToolCalls.push({ toolCallId: pending.toolCallId, toolName: pending.toolName, args: {} })
        }
      } else {
        finalToolCalls.push({
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
          args: {},
        })
      }
    }
    toolStream.clear()
  }

  // Fallback: extract inline tool calls from text if no delta/non-delta tool calls were found
  if (finalToolCalls.length === 0) {
    const inlineCalls = extractInlineToolCalls(collectedText)
    finalToolCalls.push(...inlineCalls)
    if (inlineCalls.length > 0) {
      collectedText = collectedText.replace(/```json[\s\S]*?```/g, "").trim()
    }
  }

  return {
    text: collectedText,
    reasoning: collectedReasoning,
    toolCalls: finalToolCalls,
    finishReason,
    usage,
  }
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

  const timeoutSignal = AbortSignal.timeout(120_000)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: combinedSignal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new ApiError(res.status, `API error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response body")

  const result = await parseOpenAIStream(reader, signal ?? new AbortController().signal, callbacks)
  return {
    text: result.text,
    reasoning: result.reasoning,
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
    usage: result.usage,
  }
}
