import { NextResponse } from "next/server"

const GROQ_KEY = process.env.GROQ_API_KEY
const GOOGLE_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
const OPENCODE_KEY = process.env.OPENCODE_API_KEY
const OLLAMA_KEY = process.env.OLLAMA_CLOUD_API_KEY
const PUTER_ENABLED = true

const GROQ_MODELS: { id: string; display_name: string; provider: string; provider_display_name: string }[] = [
  { id: "llama-3.3-70b-versatile", display_name: "Llama 3.3 70B Versatile", provider: "groq", provider_display_name: "Groq" },
  { id: "llama-3.1-8b-instant", display_name: "Llama 3.1 8B Instant", provider: "groq", provider_display_name: "Groq" },
  { id: "mixtral-8x7b-32768", display_name: "Mixtral 8x7B", provider: "groq", provider_display_name: "Groq" },
]

const GOOGLE_MODELS: { id: string; display_name: string; provider: string; provider_display_name: string }[] = [
  { id: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash", provider: "google", provider_display_name: "Google" },
  { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", provider: "google", provider_display_name: "Google" },
  { id: "gemini-2.0-flash", display_name: "Gemini 2.0 Flash", provider: "google", provider_display_name: "Google" },
  { id: "gemini-2.0-flash-lite", display_name: "Gemini 2.0 Flash Lite", provider: "google", provider_display_name: "Google" },
]

async function fetchOpenRouterModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
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
      headers: { Authorization: `Bearer ${OPENCODE_KEY}` },
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
      headers: { Authorization: `Bearer ${OLLAMA_KEY}` },
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

  if (GROQ_KEY) {
    groups.push({
      label: "Groq",
      models: GROQ_MODELS,
    })
  }

  if (GOOGLE_KEY) {
    groups.push({
      label: "Google",
      models: GOOGLE_MODELS,
    })
  }

  if (OPENROUTER_KEY) {
    const orModels = await fetchOpenRouterModels()
    if (orModels) {
      groups.push({
        label: "OpenRouter",
        models: orModels,
      })
    }
  }

  if (OPENCODE_KEY) {
    const ocModels = await fetchOpenCodeModels()
    if (ocModels) {
      groups.push({
        label: "OpenCode",
        models: ocModels,
      })
    }
  }

  if (OLLAMA_KEY) {
    const olModels = await fetchOllamaModels()
    if (olModels) {
      groups.push({
        label: "Ollama Cloud",
        models: olModels,
      })
    }
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
