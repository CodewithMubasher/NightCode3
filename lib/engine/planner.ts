import { streamText, tool, type ToolSet } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGroq } from "@ai-sdk/groq"
import { z } from "zod"
import type { AIProvider } from "@/types"
import type { ToolImplementation } from "./tools"

// ─── Providers ────────────────────────────────────────────────────────────────

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
})

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

const opencode = createOpenAI({
  baseURL: "https://opencode.ai/zen/v1",
  apiKey: process.env.OPENCODE_API_KEY || "",
})

const xiaomi = createOpenAI({
  baseURL: "https://api.xiaomimimo.com/v1",
  apiKey: process.env.XIAOMI_API_KEY || "",
})

const cerebras = createOpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY || "",
})

const routeway = createOpenAI({
  baseURL: "https://api.routeway.ai/v1",
  apiKey: process.env.ROUTEWAY_API_KEY || "",
})

const naga = createOpenAI({
  baseURL: "https://api.naga.ac/v1",
  apiKey: process.env.NAGA_API_KEY || "",
})

const sambanova = createOpenAI({
  baseURL: "https://api.sambanova.ai/v1",
  apiKey: process.env.SAMBANOVA_API_KEY || "",
})

const cloudflare = createOpenAI({
  baseURL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
  apiKey: process.env.CLOUDFLARE_API_TOKEN || "",
  fetch: async (url, options) => {
    const response = await fetch(url, options)
    if (!url.toString().includes("/chat/completions") || !response.body) {
      return response
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const customStream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          let chunk = decoder.decode(value, { stream: true })
          chunk = chunk.replace(/"content":\s*true/g, '"content":""')
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
    return new Response(customStream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  },
})

export function getLanguageModel(provider: AIProvider, modelId: string) {
  switch (provider) {
    case "openai":
      return openai.languageModel(modelId)
    case "openrouter":
      return openrouter.chat(modelId)
    case "groq":
      return groq.languageModel(modelId)
    case "google": {
      const { createGoogleGenerativeAI } = require("@ai-sdk/google")
      const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
      return google.languageModel(modelId)
    }
    case "opencode":
      return opencode.chat(modelId)
    case "xiaomi":
      return xiaomi.chat(modelId)
    case "cerebras":
      return cerebras.chat(modelId)
    case "routeway":
      return routeway.chat(modelId)
    case "naga":
      return naga.chat(modelId)
    case "sambanova":
      return sambanova.chat(modelId)
    case "cloudflare":
      return cloudflare.chat(modelId)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

// ─── Schema builder ────────────────────────────────────────────────────────────

function buildZodSchema(schema: Record<string, string | z.ZodTypeAny>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, type] of Object.entries(schema)) {
    if (type instanceof z.ZodType) {
      shape[key] = type
      continue
    }
    const isOptional = type.endsWith("?")
    const baseType = type.replace("?", "").trim()
    let zodType: z.ZodTypeAny
    switch (baseType) {
      case "number":
        zodType = z.number()
        break
      case "boolean":
        zodType = z.boolean()
        break
      case "string[]":
        zodType = z.array(z.string())
        break
      default:
        zodType = z.string()
    }
    shape[key] = isOptional ? zodType.optional() : zodType
  }
  return z.object(shape)
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
}

export type StepResult =
  | { type: "text"; content: string; usage?: UsageInfo }
  | { type: "tool_calls"; text: string; toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>; usage?: UsageInfo }

export type PlannerCallbacks = {
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
}

// ─── Single-step planner ───────────────────────────────────────────────────────
// Unlike the old plan(), this function does ONE LLM call — it does NOT manage
// the agent loop. Tools are registered WITHOUT execute so the SDK returns
// tool calls instead of executing them. The caller (index.ts) handles
// execution, persistence, and looping.

export async function planStep(
  messages: Array<{ role: string; content: unknown }>,
  provider: AIProvider,
  modelId: string,
  availableTools: ToolImplementation[],
  callbacks: PlannerCallbacks,
  signal?: AbortSignal,
  systemPrompt?: string
): Promise<StepResult> {
  // Ollama Cloud — native Ollama API
  if (provider === "ollama") {
    try {
      const res = await fetch("https://ollama.com/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OLLAMA_CLOUD_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
        signal,
      })
      if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
      const json = await res.json()
      const content = json.message?.content || ""
      return { type: "text", content }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      return { type: "text", content: `Ollama Cloud error: ${msg}` }
    }
  }

  // Puter fallback — unchanged
  if (provider === "puter") {
    try {
      const { default: puter } = await import("@heyputer/puter.js")
      const response = await puter.ai.chat(
        messages.map((m) => ({ role: m.role, content: m.content as string })),
        { model: modelId, temperature: 0.3 }
      )
      const content = (typeof response.message?.content === "string" ? response.message.content : "") || ""
      return { type: "text", content }
    } catch {
      return {
        type: "text",
        content: "Puter provider requires authentication and is currently unavailable. Please switch to another provider.",
      }
    }
  }

  const sanitizeText = makeTextSanitizer()

  const model = getLanguageModel(provider, modelId)
  console.log(`[planner] planStep with ${availableTools.length} tools:`, availableTools.map((t) => t.name))

  // Register tools WITHOUT execute — the engine loop handles execution
  const sdkTools = {} as Record<string, unknown>
  for (const t of availableTools) {
    sdkTools[t.name] = tool({
      description: t.description,
      inputSchema: buildZodSchema(t.schema) as any,
    })
  }

  // ── Retry helper with exponential backoff ────────────────────────────────
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
        // Only retry on rate limit or server errors
        const status = (err as any)?.status ?? (err as any)?.response?.status
        if (status && status !== 429 && status < 500) throw lastErr
        if (attempt >= maxRetries) throw lastErr
      }
    }
    throw lastErr ?? new Error("Retry failed")
  }

  async function doStreamText(
    messages: Array<{ role: string; content: unknown }>,
    tools: Record<string, unknown> | undefined
  ): Promise<{ text: string; toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>; usage: UsageInfo | undefined }> {
    const result = streamText({
      model,
      system: systemPrompt,
      messages: messages as any,
      tools: tools as ToolSet | undefined,
      temperature: 0.3,
      abortSignal: signal,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta" && callbacks.onText) {
          const safe = sanitizeText(chunk.text)
          if (safe) callbacks.onText(safe)
        }
      },
    })

    const collectedToolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> = []
    let collectedText = ""

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        collectedText += chunk.text
        collectedText = collectedText.replace(/```json[\s\S]*?```/g, "").trim()
      } else if (chunk.type === "reasoning-delta") {
        if (callbacks.onReasoning) callbacks.onReasoning(chunk.text)
      } else if (chunk.type === "tool-call") {
        collectedToolCalls.push({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input as Record<string, unknown>,
        })
      } else if (chunk.type === "error") {
        throw chunk.error
      }
    }

    const usage: UsageInfo | undefined = await (async () => {
      try {
        const u = await (result.usage as Promise<any>)
        if (u?.inputTokens != null || u?.outputTokens != null) {
          return { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, reasoningTokens: u.reasoningTokens }
        }
      } catch {}
      return undefined
    })()

    return { text: collectedText, toolCalls: collectedToolCalls, usage }
  }

  try {
    const result = await retryWithBackoff(
      () => doStreamText(messages, sdkTools),
      { signal }
    )

    if (result.toolCalls.length > 0) {
      return { type: "tool_calls", text: result.text, toolCalls: result.toolCalls, usage: result.usage }
    }

    return { type: "text", content: result.text, usage: result.usage }

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error(`[planner] Tool calling failed: ${msg}. Retrying without tools.`)

    // Fallback: text-only request with retry
    try {
      const fallbackResult = await retryWithBackoff(
        () => doStreamText(messages, undefined),
        { signal }
      )
      return { type: "text", content: fallbackResult.text, usage: fallbackResult.usage }
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
