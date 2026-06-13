import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

export type ProviderName = "openai" | "openrouter" | "google" | "opencode"

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
})

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const opencode = createOpenAI({
  baseURL: process.env.OPENCODE_BASE_URL || "https://api.opencode.ai/v1",
  apiKey: process.env.OPENCODE_API_KEY,
})

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
})

export function getModel(provider: ProviderName, modelId: string) {
  switch (provider) {
    case "openai":
      return openai.languageModel(modelId)
    case "openrouter":
      return openrouter.languageModel(modelId)
    case "opencode":
      return opencode.languageModel(modelId)
    case "google":
      return google.languageModel(modelId)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}
