import { NextResponse } from "next/server"

import { getApiKey } from "@/lib/keys"

const GROQ_KEY = () => getApiKey("GROQ_API_KEY")
const GOOGLE_KEY = () => getApiKey("GOOGLE_GENERATIVE_AI_API_KEY")
const OPENROUTER_KEY = () => getApiKey("OPENROUTER_API_KEY")
const OPENCODE_KEY = () => getApiKey("OPENCODE_API_KEY")
const OLLAMA_KEY = () => getApiKey("OLLAMA_CLOUD_API_KEY")
const XIAOMI_KEY = () => getApiKey("XIAOMI_API_KEY")
const CEREBRAS_KEY = () => getApiKey("CEREBRAS_API_KEY")
const ROUTEWAY_KEY = () => getApiKey("ROUTEWAY_API_KEY")
const NAGA_KEY = () => getApiKey("NAGA_API_KEY")
const SAMBANOVA_KEY = () => getApiKey("SAMBANOVA_API_KEY")
const CLOUDFLARE_KEY = () => getApiKey("CLOUDFLARE_API_TOKEN")
const PUTER_ENABLED = true

const GROQ_MODELS: { id: string; display_name: string; provider: string; provider_display_name: string }[] = []

const CLOUDFLARE_MODELS: { id: string; display_name: string; provider: string; provider_display_name: string }[] = [
  { id: "@cf/qwen/qwen2.5-coder-32b-instruct", display_name: "Qwen 2.5 Coder 32B", provider: "cloudflare", provider_display_name: "Cloudflare" },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", display_name: "Llama 3.3 70B", provider: "cloudflare", provider_display_name: "Cloudflare" },
  { id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", display_name: "DeepSeek R1 Distill Qwen 32B", provider: "cloudflare", provider_display_name: "Cloudflare" },
  { id: "@cf/mistral/mistral-7b-instruct-v0.3", display_name: "Mistral 7B", provider: "cloudflare", provider_display_name: "Cloudflare" },
]

const GOOGLE_MODELS: { id: string; display_name: string; provider: string; provider_display_name: string }[] = [
  { id: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash", provider: "google", provider_display_name: "Google" },
  { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", provider: "google", provider_display_name: "Google" },
  { id: "gemini-2.0-flash", display_name: "Gemini 2.0 Flash", provider: "google", provider_display_name: "Google" },
  { id: "gemini-2.0-flash-lite", display_name: "Gemini 2.0 Flash Lite", provider: "google", provider_display_name: "Google" },
]

async function fetchGroqModels() {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${GROQ_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const exclude = new Set(["whisper", "compound", "guard", "orpheus"])
    const models = (json.data || [])
      .filter((m: any) => m.id && !exclude.has(m.id.split("/")[0]?.split("-")[0]) && !m.id.includes("whisper") && !m.id.includes("guard") && !m.id.includes("compound") && !m.id.includes("orpheus") && !m.id.includes("prompt-guard"))
      .map((m: any) => ({
        id: m.id,
        display_name: m.id,
        provider: "groq",
        provider_display_name: "Groq",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchOpenRouterModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${OPENROUTER_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id && !m.id.startsWith("."))
      .map((m: any) => ({
        id: m.id,
        display_name: m.name || m.id,
        provider: "openrouter",
        provider_display_name: "OpenRouter",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchOpenCodeModels() {
  try {
    const res = await fetch("https://opencode.ai/zen/v1/models", {
      headers: { Authorization: `Bearer ${OPENCODE_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.id === "big-pickle" ? "Big Pickle (OpenCode Free MoE)" : m.id,
        provider: "opencode" as const,
        provider_display_name: "OpenCode",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchOllamaModels() {
  try {
    const res = await fetch("https://ollama.com/api/tags", {
      headers: { Authorization: `Bearer ${OLLAMA_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const raw = json.models || []
    const models = raw
      .filter((m: any) => m.name)
      .map((m: any) => ({
        id: m.name,
        display_name: m.name,
        provider: "ollama" as const,
        provider_display_name: "Ollama Cloud",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchCerebrasModels() {
  try {
    const res = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${CEREBRAS_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.id,
        provider: "cerebras" as const,
        provider_display_name: "Cerebras",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchRoutewayModels() {
  try {
    const res = await fetch("https://api.routeway.ai/v1/models", {
      headers: { Authorization: `Bearer ${ROUTEWAY_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.id,
        provider: "routeway" as const,
        provider_display_name: "Routeway",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchNagaModels() {
  try {
    const res = await fetch("https://api.naga.ac/v1/models", {
      headers: { Authorization: `Bearer ${NAGA_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.id,
        provider: "naga" as const,
        provider_display_name: "Naga",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchSambaNovaModels() {
  try {
    const res = await fetch("https://api.sambanova.ai/v1/models", {
      headers: { Authorization: `Bearer ${SAMBANOVA_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.id,
        provider: "sambanova",
        provider_display_name: "SambaNova",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchXiaomiModels() {
  try {
    const res = await fetch("https://api.xiaomimimo.com/v1/models", {
      headers: { Authorization: `Bearer ${XIAOMI_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.name || m.id,
        provider: "xiaomi" as const,
        provider_display_name: "Xiaomi",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchPuterModels() {
  try {
    const { default: puter } = await import("@heyputer/puter.js")
    const raw = await puter.ai.listModels()
    const models = (raw as any[])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.name || m.id,
        provider: "puter" as const,
        provider_display_name: "Puter",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

export async function GET() {
  const groups: { label: string; models: { id: string; display_name: string; provider: string; provider_display_name: string }[] }[] = []

  if (GROQ_KEY()) {
    const groqModels = await fetchGroqModels()
    if (groqModels) {
      groups.push({
        label: "Groq",
        models: groqModels,
      })
    }
  }

  if (GOOGLE_KEY()) {
    groups.push({
      label: "Google",
      models: GOOGLE_MODELS,
    })
  }

  if (OPENROUTER_KEY()) {
    const orModels = await fetchOpenRouterModels()
    if (orModels) {
      groups.push({
        label: "OpenRouter",
        models: orModels,
      })
    }
  }

  if (OPENCODE_KEY()) {
    const ocModels = await fetchOpenCodeModels()
    if (ocModels) {
      groups.push({
        label: "OpenCode",
        models: ocModels,
      })
    }
  }

  if (OLLAMA_KEY()) {
    const olModels = await fetchOllamaModels()
    if (olModels) {
      groups.push({
        label: "Ollama Cloud",
        models: olModels,
      })
    }
  }

  if (XIAOMI_KEY()) {
    const xmModels = await fetchXiaomiModels()
    if (xmModels) {
      groups.push({
        label: "Xiaomi",
        models: xmModels,
      })
    }
  }

  if (CEREBRAS_KEY()) {
    const cbModels = await fetchCerebrasModels()
    if (cbModels) {
      groups.push({
        label: "Cerebras",
        models: cbModels,
      })
    }
  }

  if (ROUTEWAY_KEY()) {
    const rwModels = await fetchRoutewayModels()
    if (rwModels) {
      groups.push({
        label: "Routeway",
        models: rwModels,
      })
    }
  }

  if (NAGA_KEY()) {
    const nagaModels = await fetchNagaModels()
    if (nagaModels) {
      groups.push({
        label: "Naga",
        models: nagaModels,
      })
    }
  }

  if (SAMBANOVA_KEY()) {
    const snModels = await fetchSambaNovaModels()
    if (snModels) {
      groups.push({
        label: "SambaNova",
        models: snModels,
      })
    }
  }

  if (CLOUDFLARE_KEY()) {
    groups.push({
      label: "Cloudflare",
      models: CLOUDFLARE_MODELS,
    })
  }

  if (PUTER_ENABLED) {
    const puterModels = await fetchPuterModels()
    if (puterModels) {
      groups.push({
        label: "Puter",
        models: puterModels,
      })
    }
  }

  if (groups.length === 0) {
    groups.push({
      label: "Demo",
      models: [
        { id: "gemini-2.0-flash", display_name: "Gemini 2.0 Flash", provider: "google", provider_display_name: "Google" },
      ],
    })
  }

  return NextResponse.json(groups)
}
