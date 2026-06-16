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
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

// ─── Schema builder ────────────────────────────────────────────────────────────

function buildZodSchema(schema: Record<string, string>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, type] of Object.entries(schema)) {
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

export type StepResult =
  | { type: "text"; content: string }
  | { type: "tool_calls"; text: string; toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> }

export type PlannerCallbacks = {
  onText?: (text: string) => void
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
  signal?: AbortSignal
): Promise<StepResult> {
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

  try {
    const result = streamText({
      model,
      messages: messages as any,
      tools: sdkTools as ToolSet,
      temperature: 0.3,
      abortSignal: signal,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta" && callbacks.onText) {
          callbacks.onText(chunk.text)
        }
      },
    })

    // Collect tool calls and text from the stream
    const collectedToolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> = []
    let collectedText = ""

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        collectedText += chunk.text
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

    if (collectedToolCalls.length > 0) {
      return { type: "tool_calls", text: collectedText, toolCalls: collectedToolCalls }
    }

    return { type: "text", content: collectedText }

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error(`[planner] Tool calling failed: ${msg}. Retrying without tools.`)

    // Fallback: text-only request for providers without native tool support
    const fallback = streamText({
      model,
      messages: messages as any,
      temperature: 0.3,
      abortSignal: signal,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta" && callbacks.onText) {
          callbacks.onText(chunk.text)
        }
      },
    })

    let text = ""
    for await (const chunk of fallback.fullStream) {
      if (chunk.type === "text-delta") {
        text += chunk.text
      } else if (chunk.type === "error") {
        throw chunk.error
      }
    }

    return { type: "text", content: text }
  }
}
