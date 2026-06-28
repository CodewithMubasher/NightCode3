import { NextResponse } from "next/server"

import { getApiKey, getNextKey, hasAnyKey } from "@/lib/keys"

type ModelGroup = { label: string; models: { id: string; display_name: string; provider: string; provider_display_name: string }[] }

const CACHE_TTL = 300_000 // 5 minutes
let cache: { data: ModelGroup[]; expiry: number } | null = null

async function getCached(fetchFn: () => Promise<ModelGroup[]>): Promise<ModelGroup[]> {
  const now = Date.now()
  if (cache && cache.expiry > now) return cache.data
  const data = await fetchFn()
  cache = { data, expiry: now + CACHE_TTL }
  return data
}

const GROQ_HAS_KEY = () => hasAnyKey("GROQ_API_KEY")
const GROQ_KEY = () => getNextKey("GROQ_API_KEY")
const GOOGLE_HAS_KEY = () => hasAnyKey("GOOGLE_GENERATIVE_AI_API_KEY")
const OPENROUTER_KEY = () => getApiKey("OPENROUTER_API_KEY")
const OLLAMA_KEY = () => getApiKey("OLLAMA_CLOUD_API_KEY")
const XIAOMI_KEY = () => getApiKey("XIAOMI_API_KEY")
const CEREBRAS_KEY = () => getApiKey("CEREBRAS_API_KEY")
const NAGA_KEY = () => getApiKey("NAGA_API_KEY")
const SAMBANOVA_KEY = () => getApiKey("SAMBANOVA_API_KEY")
const FREETHEAI_KEY = () => getApiKey("FREETHEAI_API_KEY")
const CLOUDFLARE_KEY = () => getApiKey("CLOUDFLARE_API_TOKEN")
const NVIDIA_KEY = () => getApiKey("NVIDIA_API_KEY")

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

async function fetchFreeTheAIModels() {
  try {
    const res = await fetch("https://api.freetheai.xyz/v1/models", {
      headers: { Authorization: `Bearer ${FREETHEAI_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const models = (json.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id,
        display_name: m.id,
        provider: "freetheai" as const,
        provider_display_name: "FreeTheAI",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

const LOCAL_AI_BASE = process.env.LOCAL_AI_URL
  ? process.env.LOCAL_AI_URL.replace(/\/api\/chat$/, "")
  : "http://127.0.0.1:8000"

async function fetchLocalModels(): Promise<{ id: string; display_name: string; provider: string; provider_display_name: string }[]> {
  try {
    const res = await fetch(`${LOCAL_AI_BASE}/api/models`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return fallbackLocalModels()
    const json = await res.json()
    if (!Array.isArray(json) || json.length === 0) return fallbackLocalModels()
    return json.map((m: any) => ({
      id: m.id || "local-model",
      display_name: m.display_name || m.id || "Local AI",
      provider: "local",
      provider_display_name: "Local AI",
    }))
  } catch {
    return fallbackLocalModels()
  }
}

function fallbackLocalModels(): { id: string; display_name: string; provider: string; provider_display_name: string }[] {
  return [
    { id: "gemini-3-pro", display_name: "Gemini 3 Pro", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-flash", display_name: "Gemini 3 Flash", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-flash-thinking", display_name: "Gemini 3 Flash Thinking", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-pro-plus", display_name: "Gemini 3 Pro Plus", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-flash-plus", display_name: "Gemini 3 Flash Plus", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-flash-thinking-plus", display_name: "Gemini 3 Flash Thinking Plus", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-pro-advanced", display_name: "Gemini 3 Pro Advanced", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-flash-advanced", display_name: "Gemini 3 Flash Advanced", provider: "local", provider_display_name: "Local AI" },
    { id: "gemini-3-flash-thinking-advanced", display_name: "Gemini 3 Flash Thinking Advanced", provider: "local", provider_display_name: "Local AI" },
  ]
}

async function fetchNvidiaModels() {
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${NVIDIA_KEY()}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const exclude = new Set(["gliner-pii", "nemoguard", "riva-translate", "usdcode", "shieldgemma", "reward", "embed", "rerank"])
    const models = (json.data || [])
      .filter((m: any) => {
        if (!m.id) return false
        const lower = m.id.toLowerCase()
        if (exclude.has(lower)) return false
        for (const term of exclude) {
          if (lower.includes(term)) return false
        }
        return true
      })
      .map((m: any) => ({
        id: m.id,
        display_name: m.id,
        provider: "nvidia" as const,
        provider_display_name: "NVIDIA",
      }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

export async function GET() {
  return getCached(async () => {
    const groups: { label: string; models: { id: string; display_name: string; provider: string; provider_display_name: string }[] }[] = []

    // ── Static groups (no HTTP fetch needed) ──
    if (GOOGLE_HAS_KEY()) {
      groups.push({ label: "Google", models: GOOGLE_MODELS })
    }
    if (CLOUDFLARE_KEY()) {
      groups.push({ label: "Cloudflare", models: CLOUDFLARE_MODELS })
    }

    // ── Fetch all dynamic providers in parallel ──
    const tasks: Array<{ label: string; fetch: () => Promise<typeof GOOGLE_MODELS | null> }> = []

    if (GROQ_HAS_KEY())       tasks.push({ label: "Groq",       fetch: fetchGroqModels })
    if (OPENROUTER_KEY())     tasks.push({ label: "OpenRouter", fetch: fetchOpenRouterModels })
    if (OLLAMA_KEY())         tasks.push({ label: "Ollama Cloud", fetch: fetchOllamaModels })
    if (XIAOMI_KEY())         tasks.push({ label: "Xiaomi",     fetch: fetchXiaomiModels })
    if (CEREBRAS_KEY())       tasks.push({ label: "Cerebras",   fetch: fetchCerebrasModels })
    if (NAGA_KEY())           tasks.push({ label: "Naga",       fetch: fetchNagaModels })
    if (SAMBANOVA_KEY())      tasks.push({ label: "SambaNova",  fetch: fetchSambaNovaModels })
    if (FREETHEAI_KEY())      tasks.push({ label: "FreeTheAI",  fetch: fetchFreeTheAIModels })
    if (NVIDIA_KEY())         tasks.push({ label: "NVIDIA",     fetch: fetchNvidiaModels })

    // Local AI also fetches but with a shorter timeout — include in parallel
    tasks.push({ label: "Local AI", fetch: fetchLocalModels })

    const results = await Promise.allSettled(tasks.map((t) => t.fetch()))

    for (let i = 0; i < tasks.length; i++) {
      const r = results[i]
      if (r.status === "fulfilled" && r.value && r.value.length > 0) {
        groups.push({ label: tasks[i].label, models: r.value })
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

    return groups
  }).then((groups) => NextResponse.json(groups))
}
