import type { GatewayCallbacks, StreamResult, ToolDef, UsageInfo } from "./common"
import { buildToolsArray, getTemperature, getModelParam, formatOpenAIMessages, extractInlineToolCalls, ApiError } from "./common"

interface PendingTool {
  toolCallId: string
  toolName: string
  input: string
}

/**
 * Try to repair truncated JSON by closing unclosed strings and braces.
 * Returns null if the JSON is genuinely broken (not just truncated).
 */
function tryRepairTruncatedJson(input: string): string | null {
  try { JSON.parse(input); return input } catch {}

  let repaired = input.trimEnd()

  // Detect if we're inside an unterminated string at the end
  let inString = false
  let escape = false
  for (let i = 0; i < repaired.length; i++) {
    if (escape) { escape = false; continue }
    if (repaired[i] === '\\') { escape = true; continue }
    if (repaired[i] === '"' && !escape) inString = !inString
  }

  // Close unterminated string
  if (inString) repaired += '"'

  // Close missing braces and brackets (count-based, handles common truncation)
  const openBraces = (repaired.match(/{/g) || []).length
  const closeBraces = (repaired.match(/}/g) || []).length
  const openBrackets = (repaired.match(/\[/g) || []).length
  const closeBrackets = (repaired.match(/\]/g) || []).length

  repaired += '}'.repeat(Math.max(0, openBraces - closeBraces))
  repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets))

  try { JSON.parse(repaired); return repaired } catch {}
  return null
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
  let chunkCount = 0

  while (true) {
    let value: Uint8Array | undefined
    try {
      const readResult = await reader.read()
      if (readResult.done) break
      value = readResult.value
    } catch {
      // Stream errored (e.g. timeout abort) — exit loop, finalize pending tools
      break
    }

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
            console.log(`[stream] non-delta tool_calls: ${JSON.stringify(msg.tool_calls.map((tc: any) => ({id: tc.id, name: tc.function?.name, args: tc.function?.arguments})))}`)
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
          if (msg?.reasoning_content) {
            callbacks.onReasoning?.(msg.reasoning_content)
            collectedReasoning += msg.reasoning_content
          }
          if (choices[0].finish_reason) {
            finishReason = choices[0].finish_reason
          }
        }

        for (const choice of choices) {
          const delta = choice.delta ?? {}
          chunkCount++

          if (delta.content) {
            callbacks.onText?.(delta.content)
            collectedText += delta.content
          }

          if (delta.reasoning_content) {
            callbacks.onReasoning?.(delta.reasoning_content)
            collectedReasoning += delta.reasoning_content
          }

          // Track finish_reason from the provider
          if (choice.finish_reason) {
            if (finishReason !== choice.finish_reason) {
              console.log(`[stream] finish_reason: ${choice.finish_reason} at chunk ${chunkCount}`)
            }
            finishReason = choice.finish_reason
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? toolStream.size
              const existing = toolStream.get(index)
              console.log(`[stream] delta tc[${index}] id=${tc.id} name=${tc.function?.name} argsType=${typeof tc.function?.arguments} argsRaw=${typeof tc.function?.arguments === 'string' ? tc.function.arguments.slice(0,80) : JSON.stringify(tc.function?.arguments).slice(0,80)}`)

              // First delta for this index → start new tool (appendOrStart)
              if (!existing && tc.function?.name) {
                toolStream.set(index, {
                  toolCallId: tc.id ?? `call_${Date.now()}`,
                  toolName: tc.function.name,
                  input: "",
                })
              }

              // Emit real-time tool call feedback
              if (tc.id && tc.function?.name && !existing) {
                callbacks.onToolCallStart?.(tc.id, tc.function.name)
              }
              const current = toolStream.get(index)
              if (tc.id && tc.function?.arguments && current) {
                if (typeof tc.function.arguments === "string") {
                  callbacks.onToolCallDelta?.(tc.id, tc.function.arguments)
                }
              }

              // Append argument text across chunks (accumulate, don't parse yet)
              if (current && tc.function?.arguments) {
                if (typeof tc.function.arguments === "string") {
                  current.input += tc.function.arguments
                  console.log(`[stream] acc tc[${index}] id=${current.toolCallId} accumulated=${current.input.length}ch`)
                } else if (typeof tc.function.arguments === "object" && tc.function.arguments !== null) {
                  // Provider pre-parsed the JSON — finalize immediately
                  current.input = ""
                  console.log(`[stream] FINALIZE tc[${index}] id=${current.toolCallId} name=${current.toolName} args=${JSON.stringify(tc.function.arguments)}`)
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
          console.log(`[stream] finalizing ${toolStream.size} pending tool(s) on finish_reason=${finishReason}`)
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
                  console.error(`[stream] parsed tool args not object for ${pending.toolName}: type=${typeof parsed}`)
                  finalToolCalls.push({
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    args: { _parseError: `not an object, got ${typeof parsed}`, _rawValue: String(parsed) },
                  })
                }
              } catch (e) {
                const prefix = pending.input.slice(0, 300)
                const suffix = pending.input.slice(-300)
                console.error(`[stream] JSON.parse failed for ${pending.toolName} (${pending.input.length}ch): ${e}`)
                console.error(`[stream] args PREFIX: ${prefix}`)
                console.error(`[stream] args SUFFIX: ${suffix}`)
                const repaired = tryRepairTruncatedJson(pending.input)
                if (repaired) {
                  const parsed = JSON.parse(repaired)
                  console.error(`[stream] REPAIRED truncated JSON for ${pending.toolName}`)
                  finalToolCalls.push({
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    args: parsed as Record<string, unknown>,
                  })
                } else {
                  console.error(`[stream] FAILED to repair truncated JSON for ${pending.toolName}`)
                  finalToolCalls.push({
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    args: { _truncated: true, _rawInput: pending.input },
                  })
                }
              }
            } else if (!finalToolCalls.some(tc => tc.toolCallId === pending.toolCallId)) {
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
    console.log(`[stream] stream ended, finalizing ${toolStream.size} remaining tool(s)`)
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
            console.error(`[stream] stream-end: parsed tool args not object for ${pending.toolName}: type=${typeof parsed}`)
            finalToolCalls.push({
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              args: { _parseError: `not an object, got ${typeof parsed}`, _rawValue: String(parsed) },
            })
          }
        } catch (e) {
          const prefix = pending.input.slice(0, 300)
          const suffix = pending.input.slice(-300)
          console.error(`[stream] stream-end: JSON.parse failed for ${pending.toolName} (${pending.input.length}ch): ${e}`)
          console.error(`[stream] stream-end: args PREFIX: ${prefix}`)
          console.error(`[stream] stream-end: args SUFFIX: ${suffix}`)
          const repaired = tryRepairTruncatedJson(pending.input)
          if (repaired) {
            const parsed = JSON.parse(repaired)
            console.error(`[stream] stream-end: REPAIRED truncated JSON for ${pending.toolName}`)
            finalToolCalls.push({
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              args: parsed as Record<string, unknown>,
            })
          } else {
            console.error(`[stream] stream-end: FAILED to repair truncated JSON for ${pending.toolName}`)
            finalToolCalls.push({
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              args: { _truncated: true, _rawInput: pending.input },
            })
          }
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

  console.log(`[stream] FINAL text=${collectedText.length}ch reasoning=${collectedReasoning.length}ch tools=${finalToolCalls.length} finish=${finishReason}`)
  for (const tc of finalToolCalls) {
    console.log(`[stream]   tool id=${tc.toolCallId} name=${tc.toolName} args=${JSON.stringify(tc.args)}`)
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

  // Use a streaming-specific timeout (120s) separate from withRetry's 30s connection timeout.
  // The fetch-level signal (combined with user's abort) still aborts the body reader if
  // the user cancels — this 120s is just a safety net for the streaming phase.
  const streamAbortSignal = AbortSignal.timeout(120_000)
  const result = await parseOpenAIStream(reader, streamAbortSignal, callbacks)
  return {
    text: result.text,
    reasoning: result.reasoning,
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
    usage: result.usage,
  }
}
