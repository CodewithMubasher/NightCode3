import { streamChat } from "./stream-client"
import { streamGroqChat } from "./providers/groq"

export interface ExecuteLLMOptions {
  provider: string
  model: string
  messages: Array<{ role: string; content: string }>
  systemPrompt?: string
  onChunk: (chunk: string) => void
}

export function getDefaultModel(provider: string): string {
  switch (provider) {
    case "groq":
      return "llama-3.1-8b-instant"
    default:
      return "deepseek-v4-flash-free"
  }
}

export async function executeLLM(options: ExecuteLLMOptions): Promise<string> {
  const { provider, model, messages, systemPrompt, onChunk } = options

  switch (provider) {
    case "groq":
      return streamGroqChat({ messages, model, systemPrompt, onChunk })
    case "opencode":
      return streamChat({ messages, model, systemPrompt, onChunk })
    default:
      throw new Error(`Unknown provider "${provider}". Supported: groq, opencode`)
  }
}
