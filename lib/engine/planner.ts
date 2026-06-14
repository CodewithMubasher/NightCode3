import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGroq } from "@ai-sdk/groq"
import type { AIProvider } from "@/types"

const OPENCODE_BASE = process.env.OPENCODE_BASE_URL || "https://api.opencode.ai/v1"

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
})

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const opencode = createOpenAI({
  baseURL: OPENCODE_BASE,
  apiKey: process.env.OPENCODE_API_KEY,
})

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

function getLanguageModel(provider: AIProvider, modelId: string) {
  switch (provider) {
    case "openai":
      return openai.languageModel(modelId)
    case "openrouter":
      return openrouter.languageModel(modelId)
    case "opencode":
      return opencode.languageModel(modelId)
    case "groq":
      return groq.languageModel(modelId)
    case "google": {
      const { createGoogleGenerativeAI } = require("@ai-sdk/google")
      const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
      return google.languageModel(modelId)
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

export type PlannerOutput =
  | { action: "tool_call"; tool: string; args: Record<string, unknown> }
  | { action: "respond"; content: string }

export async function plan(
  messages: Array<{ role: string; content: string }>,
  provider: AIProvider,
  modelId: string,
  signal?: AbortSignal
): Promise<PlannerOutput> {
  const model = getLanguageModel(provider, modelId)

  const result = await generateText({
    model,
    messages: messages as any,
    abortSignal: signal,
    temperature: 0.3,
  })

  const text = result.text.trim()
  return parsePlannerOutput(text)
}

function parsePlannerOutput(text: string): PlannerOutput {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "").trim()

  const jsonStart = cleaned.indexOf("{")
  const jsonEnd = cleaned.lastIndexOf("}")
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1)
    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed.action === "tool_call" && parsed.tool) {
        return { action: "tool_call", tool: parsed.tool, args: parsed.args ?? {} }
      }
      if (parsed.action === "respond" && typeof parsed.content === "string") {
        return { action: "respond", content: parsed.content }
      }
    } catch {
      // fall through
    }
  }

  return { action: "respond", content: text }
}
