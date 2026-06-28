import { getNextKey, buildAuthHeaders, getBaseUrl } from "@/lib/keys/router"
import type { KeySlot } from "@/lib/keys/router"
import type { GatewayCallbacks, StreamResult, ToolDef } from "./providers/common"
import { streamOpenAI } from "./providers/openai"
import { streamGoogle } from "./providers/google"
import { streamOllama } from "./providers/ollama"
import { streamLocal } from "./providers/local"

const OPENAI_COMPATIBLE = new Set([
  "groq", "openai", "openrouter", "opencode", "xiaomi",
  "cerebras", "naga", "sambanova", "freetheai", "cloudflare", "nvidia",
])

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
  const headers = keySlot ? buildAuthHeaders(provider, keySlot) : {}

  if (provider === "local") {
    const url = getBaseUrl(provider, model, false, null)
    return streamLocal(messages, model, callbacks, headers, url, systemPrompt, tools, signal)
  }

  if (!keySlot) throw new Error(`No key available for provider: ${provider}`)

  if (provider === "google" || provider === "google_image") {
    return streamGoogle(messages, model, tools, systemPrompt, callbacks, headers, keySlot, signal)
  }

  if (OPENAI_COMPATIBLE.has(provider)) {
    const url = getBaseUrl(provider, model, false, null)
    return streamOpenAI(messages, model, systemPrompt, tools, callbacks, headers, url, signal)
  }

  if (provider === "ollama") {
    const url = getBaseUrl(provider, model, false, null)
    return streamOllama(messages, model, callbacks, headers, url, signal)
  }

  throw new Error(`Unknown provider: ${provider}`)
}
