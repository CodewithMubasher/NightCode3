import { Effect, Layer } from "effect"
import { ProviderRegistry, ProviderPlugin, ProviderResponse, ProviderError, Logger } from "./nightcode-effect"
import { getNextKey, buildAuthHeaders, getBaseUrl } from "@/lib/keys/router"

const providerMap = new Map<string, ProviderPlugin>()

function parseOpenAIStreamResponse(raw: unknown): ProviderResponse {
  const response = raw as { text?: string; toolCalls?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>; usage?: { inputTokens: number; outputTokens: number; reasoningTokens?: number } }
  return {
    text: response.text ?? "",
    toolCalls: response.toolCalls ?? [],
    usage: response.usage,
  }
}

// ─── Built-in provider plugins ────────────────────────────────────────────
function registerBuiltins() {
  const providers: ProviderPlugin[] = [
    {
      id: "openai",
      displayName: "OpenAI",
      supportsToolCalling: true,
      baseUrl: "https://api.openai.com/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
      rpm: 500,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
    {
      id: "groq",
      displayName: "Groq",
      supportsToolCalling: true,
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
      rpm: 30,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
    {
      id: "google",
      displayName: "Google Gemini",
      supportsToolCalling: true,
      baseUrl: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?alt=sse`,
      headers: (key) => ({ "x-goog-api-key": key, "Content-Type": "application/json" }),
      rpm: 60,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
    {
      id: "nvidia",
      displayName: "NVIDIA",
      supportsToolCalling: true,
      baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
      rpm: 40,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
    {
      id: "openrouter",
      displayName: "OpenRouter",
      supportsToolCalling: true,
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
      rpm: 60,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
    {
      id: "cerebras",
      displayName: "Cerebras",
      supportsToolCalling: true,
      baseUrl: "https://inference.cerebras.ai/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
      rpm: 30,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
    {
      id: "cloudflare",
      displayName: "Cloudflare",
      supportsToolCalling: true,
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1/chat/completions",
      headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
      rpm: 50,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
    {
      id: "local",
      displayName: "Local Proxy",
      supportsToolCalling: true,
      baseUrl: "http://localhost:11434/v1/chat/completions",
      headers: () => ({ "Content-Type": "application/json" }),
      rpm: 100,
      parseResponse: (raw) => Effect.succeed(parseOpenAIStreamResponse(raw)),
    },
  ]

  for (const p of providers) {
    providerMap.set(p.id, p)
  }
}

registerBuiltins()

export const ProviderRegistryLive = Layer.succeed(ProviderRegistry, {
  register: (plugin: ProviderPlugin) =>
    Effect.sync(() => {
      providerMap.set(plugin.id, plugin)
    }),

  get: (id: string) =>
    Effect.sync(() => {
      const plugin = providerMap.get(id)
      if (!plugin) {
        throw new ProviderError(id, 0, `Unknown provider: ${id}`)
      }
      return plugin
    }),

  list: () => Effect.sync(() => [...providerMap.values()]),

  supportsToolCalling: (id: string) =>
    Effect.sync(() => {
      return providerMap.get(id)?.supportsToolCalling ?? false
    }),
})
