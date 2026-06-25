import { getNextKey, getBaseUrl, buildAuthHeaders, reportFailure } from "@/lib/keys/router"

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
}

export interface GatewayCallbacks {
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
}

export interface StreamResult {
  text: string
  reasoning: string
  toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>
  usage?: UsageInfo
}

function getTemperature(modelId: string): number | undefined {
  const id = modelId.toLowerCase()
  if (id.includes("qwen")) return 0.55
  if (id.includes("gemini")) return 1.0
  if (id.includes("o1") || id.includes("o3") || id.includes("o4") || id.includes("o5")) return 1.0
  if (id.includes("gpt-5")) return 1.0
  if (id.includes("deepseek")) return 0.7
  if (id.includes("claude-sonnet-5")) return 1.0
  if (id.includes("claude")) return undefined
  return 0.3
}

// ─── Tool schema → OpenAI function-calling format ──────────────────────────
interface ToolDef {
  name: string
  description: string
  schema: Record<string, string | any>
}

function buildToolsArray(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.entries(t.schema).reduce((acc, [key, type]) => {
          const isOptional = typeof type === "string" && type.endsWith("?")
          const baseType = typeof type === "string" ? type.replace("?", "").trim() : "string"
          let tsType: string
          switch (baseType) {
            case "number": tsType = "number"; break
            case "boolean": tsType = "boolean"; break
            case "string[]": tsType = "array"; break
            default: tsType = "string"
          }
          acc[key] = { type: tsType, description: typeof type === "string" ? type : "parameter" }
          if (isOptional) acc[key].optional = true
          return acc
        }, {} as Record<string, any>),
        required: Object.entries(t.schema)
          .filter(([, type]) => !(typeof type === "string" && type.endsWith("?")))
          .map(([key]) => key),
      },
    },
  }))
}

// ─── Parse OpenAI SSE stream ──────────────────────────────────────────────
async function parseOpenAIStream(
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
          const choices = json.choices ?? []

          // Handle non-streaming format: choices[0].message.content
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

            if (delta.reasoning_content) {
              callbacks.onReasoning?.(delta.reasoning_content)
              collectedReasoning += delta.reasoning_content
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
                    last.args = { ...last.args, ...parsed }
                  } catch {
                    last.args = { ...last.args, _raw: tc.function.arguments }
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

  return { text: collectedText, reasoning: collectedReasoning, toolCalls: collectedToolCalls, usage }
}

// ─── Parse Google Gemini SSE stream ───────────────────────────────────────
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
  let functionCallInProgress: { id: string; name: string; args: string } | null = null

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

          if (part.functionCall) {
            collectedToolCalls.push({
              toolCallId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              toolName: part.functionCall.name,
              args: part.functionCall.args ?? {},
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

// ─── Format messages for OpenAI-compatible APIs ───────────────────────────
// Tool messages must have `tool_call_id` as a top-level field and string content.
// Multimodal user messages must preserve content arrays with image_url parts.
function formatOpenAIMessages(
  messages: Array<{ role: string; content: unknown }>,
): Array<{ role: string; content: string | Array<Record<string, unknown>>; tool_call_id?: string }> {
  return messages.map((m) => {
    if (m.role === "tool" && Array.isArray(m.content)) {
      const toolResult = m.content.find(
        (p: any) => p.type === "tool-result"
      )
      const output = toolResult?.output ?? m.content
      return {
        role: "tool",
        tool_call_id: toolResult?.toolCallId ?? `call_${Date.now()}`,
        content: typeof output === "string" ? output : JSON.stringify(output),
      }
    }

    if (Array.isArray(m.content)) {
      const parts = m.content.map((p: any) => {
        if (p.type === "text") return { type: "text", text: p.text }
        if (p.type === "image") {
          const b64 = p.image ?? ""
          const mime = p.mimeType ?? "image/png"
          return { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        }
        if (p.type === "file") {
          const b64 = p.data ?? ""
          const mime = p.mimeType ?? "application/pdf"
          return { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        }
        return { type: "text", text: JSON.stringify(p) }
      })
      return { role: m.role, content: parts }
    }

    return {
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }
  })
}

// ─── Stream chat ──────────────────────────────────────────────────────────
export async function streamChat(
  messages: Array<{ role: string; content: unknown }>,
  provider: string,
  model: string,
  tools: ToolDef[] | undefined,
  systemPrompt: string | undefined,
  callbacks: GatewayCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const keySlot = getNextKey(provider)
  if (!keySlot) throw new Error(`No key available for provider "${provider}"`)

  console.log(`[gateway] streamChat called: provider=${provider}, model=${model}, systemPrompt=${systemPrompt ? `YES(${systemPrompt.length} chars)` : "EMPTY/UNDEFINED"}`)

  const headers = buildAuthHeaders(provider, keySlot)
  let url: string

  // OpenAI-compatible providers use /v1/chat/completions
  const openAIProviders = new Set([
    "groq", "openai", "openrouter", "opencode", "xiaomi",
    "cerebras", "routeway", "naga", "sambanova", "freetheai", "cloudflare",
  ])

  if (provider === "google" || provider === "google_image") {
    url = getBaseUrl(provider, model, false, keySlot)
    if (keySlot.type === "API_KEY") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?alt=sse&key=${keySlot.value}`
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?alt=sse`
    }

    const body: Record<string, unknown> = {
      contents: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : m.role,
          parts: typeof m.content === "string"
            ? [{ text: m.content }]
            : Array.isArray(m.content)
              ? m.content.map((p: any) => {
                  if (p.type === "text") return { text: p.text }
                  if (p.type === "image") return { inlineData: { mimeType: p.mimeType ?? "image/png", data: p.image } }
                  if (p.type === "file") return { inlineData: { mimeType: p.mimeType ?? "application/pdf", data: p.data } }
                  return { text: JSON.stringify(p) }
                })
              : [{ text: JSON.stringify(m.content) }],
        })),
    }

    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] }
      console.log(`[gateway] Gemini systemInstruction set, length: ${systemPrompt.length}`)
    } else {
      console.log(`[gateway] Gemini systemPrompt is EMPTY/UNDEFINED`)
    }

    if (tools && tools.length > 0) {
      body.tools = buildGeminiTools(tools)
    }

    const temp = getTemperature(model)
    if (temp !== undefined) {
      body.generationConfig = { temperature: temp }
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const errText = await res.text()
      reportFailure(provider, res.status, keySlot.value)
      throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")

    return await parseGeminiStream(reader, signal ?? new AbortController().signal, callbacks)
  }

  if (openAIProviders.has(provider)) {
    url = getBaseUrl(provider, model, false, null)
    const body: Record<string, unknown> = {
      model: getModelParam(provider, model),
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
      reportFailure(provider, res.status, keySlot.value)
      throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")

    return await parseOpenAIStream(reader, signal ?? new AbortController().signal, callbacks)
  }

  if (provider === "ollama") {
    url = getBaseUrl(provider, model, false, null)

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: formatOpenAIMessages(messages),
        stream: true,
      }),
      signal,
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Ollama API error ${res.status}: ${errText.slice(0, 200)}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")

    let collectedText = ""
    let usage: UsageInfo | undefined
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const json = JSON.parse(trimmed)
          if (json.done) {
            if (json.prompt_eval_count != null || json.eval_count != null) {
              usage = {
                inputTokens: json.prompt_eval_count ?? 0,
                outputTokens: json.eval_count ?? 0,
              }
            }
            break
          }
          const delta = json.message?.content || ""
          if (delta) {
            collectedText += delta
            callbacks.onText?.(delta)
          }
        } catch {}
      }
    }

    return { text: collectedText, reasoning: "", toolCalls: [], usage }
  }

  if (provider === "local") {
    const url = getBaseUrl(provider, model, false, null)

    // Build full conversation history as a single prompt
    const historyParts: string[] = []
    for (const m of messages) {
      if (m.role === "system") continue
      const text = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? (m.content as any[]).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
          : ""
      if (!text.trim()) continue
      if (m.role === "user") {
        historyParts.push(`User: ${text}`)
      } else if (m.role === "assistant") {
        historyParts.push(`Assistant: ${text}`)
      } else if (m.role === "tool") {
        historyParts.push(`Tool Result: ${text}`)
      }
    }
    const conversationMessage = historyParts.join("\n\n")

    // Local provider system prompt — replaces the default AGENT_PROMPT
    const LOCAL_SYSTEM_PROMPT = `RUNTIME MODEL

You are NightCode.

IMPORTANT:

You are NOT responsible for executing tools.

You generate structured tool requests.

The NightCode runtime executes those requests and returns results.

Never claim that you lack tool access.
Never claim that you cannot access files.
Never say "I am Gemini".
Never explain limitations.

If a tool is required:
Generate the tool request.
The runtime will handle execution.

Tool requests are instructions to NightCode, not actions you perform yourself.

RESPONSE MODES

You have only two valid response modes:

MODE 1 — TOOL REQUEST

When a tool is needed:

Output ONLY valid JSON.

Do not include markdown.

Do not explain.

Do not add commentary.

Do not wrap JSON in code fences.

Example:

{
  "tool": "write_file",
  "arguments": {
    "path": "main.py",
    "content": "print('hello world')"
  }
}

MODE 2 — FINAL RESPONSE

When no tool is needed, or after all tool calls are completed:

Respond normally.

Summarize what was created, modified, analyzed, or found.

Example 1 — Create File
USER:
Create main.py that prints hello world

ASSISTANT:

{
  "tool": "write_file",
  "arguments": {
    "path": "main.py",
    "content": "print('hello world')\\n"
  }
}

Example 2 — Read File
USER:
Read package.json

ASSISTANT:

{
  "tool": "read_file",
  "arguments": {
    "path": "package.json"
  }
}

Example 3 — Search
USER:
Find all references to OpenAI

ASSISTANT:

{
  "tool": "grep",
  "arguments": {
    "pattern": "OpenAI"
  }
}

Example 4 — Edit File
USER:
Rename appName to projectName

ASSISTANT:

{
  "tool": "edit_file",
  "arguments": {
    "path": "config.ts",
    "oldText": "appName",
    "newText": "projectName"
  }
}

Example 5 — Artifact
USER:
Create a roadmap for NightCode

ASSISTANT:

{
  "tool": "create_artifact",
  "arguments": {
    "title": "NightCode Roadmap",
    "type": "roadmap",
    "content": "..."
  }
}

TOOL RESULT HANDLING

After receiving a tool result:

Do not call the same tool again unless necessary.

Write a concise summary.

Examples:

File created:
"Created main.py containing a Hello World script."

Artifact created:
"Created a project roadmap artifact with milestones and priorities."

Image generated:
"Generated the requested image successfully."

Available tools: read_file, write_file, edit_file, list_directory, search_files, execute_command, grep, create_folder, delete_file, create_artifact, list_artifacts, read_artifact, edit_artifact, search_memories, generate_image`

    const localSystemPrompt = LOCAL_SYSTEM_PROMPT

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: conversationMessage,
        system_prompt: localSystemPrompt,
      }),
      signal,
    })

    console.log(`[gateway] Local AI: system_prompt length=${localSystemPrompt.length}, message length=${conversationMessage.length}`)
    console.log(`[gateway] Local AI: system_prompt preview: ${localSystemPrompt.substring(0, 100)}...`)

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Local AI error ${res.status}: ${errText.slice(0, 200)}`)
    }

    const json = await res.json()
    let text = json.text ?? ""

    // Append any images from the response as markdown
    if (json.images && Array.isArray(json.images) && json.images.length > 0) {
      const imageMd = json.images
        .map((img: any) => {
          if (img.url) return `![${img.alt || img.title || "image"}](${img.url})`
          return ""
        })
        .filter(Boolean)
        .join("\n")
      if (imageMd) text = text ? `${text}\n\n${imageMd}` : imageMd
    }

    // Parse JSON tool calls from response text
    const toolCalls: StreamResult["toolCalls"] = []
    const jsonMatch = text.match(/\{[\s\S]*"tool"[\s\S]*"arguments"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        const toolName = parsed.tool ?? parsed.name
        if (toolName && parsed.arguments) {
          toolCalls.push({
            toolCallId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            toolName,
            args: parsed.arguments,
          })
          text = text.replace(jsonMatch[0], "").trim()
        }
      } catch {}
    }

    callbacks.onText?.(text)

    return { text, reasoning: "", toolCalls, usage: undefined }
  }

  throw new Error(`Unsupported provider for streaming: ${provider}`)
}

function getModelParam(provider: string, model: string): string {
  return model
}

function buildGeminiTools(tools: ToolDef[]): unknown[] {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.entries(t.schema).reduce((acc, [key, type]) => {
          const isOptional = typeof type === "string" && type.endsWith("?")
          const baseType = typeof type === "string" ? type.replace("?", "").trim() : "string"
          let tsType: string
          switch (baseType) {
            case "number": tsType = "number"; break
            case "boolean": tsType = "boolean"; break
            case "string[]": tsType = "array"; break
            default: tsType = "string"
          }
          acc[key] = { type: tsType, description: typeof type === "string" ? type : "parameter" }
          if (isOptional) acc[key].optional = true
          return acc
        }, {} as Record<string, any>),
        required: Object.entries(t.schema)
          .filter(([, type]) => !(typeof type === "string" && type.endsWith("?")))
          .map(([key]) => key),
      },
    })),
  }]
}


