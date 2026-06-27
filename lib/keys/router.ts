import { getApiKey } from "@/lib/keys"

export type KeyType = "API_KEY" | "AUTH_TOKEN" | "BEARER"

export interface KeySlot {
  value: string
  type: KeyType
  provider: string
  penalizedUntil: number
}

interface ProviderConfig {
  envBase: string
  maxSuffixed: number
  authType: KeyType
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  google:    { envBase: "GOOGLE_GENERATIVE_AI_API_KEY", maxSuffixed: 10, authType: "API_KEY" },
  google_image: { envBase: "GOOGLE_IMAGE_KEY", maxSuffixed: 4, authType: "API_KEY" },
  groq:      { envBase: "GROQ_API_KEY",              maxSuffixed: 10, authType: "BEARER" },
  openai:    { envBase: "OPENAI_API_KEY",             maxSuffixed: 0,  authType: "BEARER" },
  openrouter:{ envBase: "OPENROUTER_API_KEY",         maxSuffixed: 4,  authType: "BEARER" },
  opencode:  { envBase: "OPENCODE_API_KEY",           maxSuffixed: 0,  authType: "BEARER" },
  ollama:    { envBase: "OLLAMA_CLOUD_API_KEY",       maxSuffixed: 0,  authType: "BEARER" },
  xiaomi:    { envBase: "XIAOMI_API_KEY",             maxSuffixed: 0,  authType: "BEARER" },
  cerebras:  { envBase: "CEREBRAS_API_KEY",           maxSuffixed: 0,  authType: "BEARER" },
  routeway:  { envBase: "ROUTEWAY_API_KEY",           maxSuffixed: 0,  authType: "BEARER" },
  naga:      { envBase: "NAGA_API_KEY",               maxSuffixed: 0,  authType: "BEARER" },
  sambanova: { envBase: "SAMBANOVA_API_KEY",          maxSuffixed: 0,  authType: "BEARER" },
  freetheai: { envBase: "FREETHEAI_API_KEY",          maxSuffixed: 0,  authType: "BEARER" },
  cloudflare:{ envBase: "CLOUDFLARE_API_TOKEN",       maxSuffixed: 0,  authType: "BEARER" },
  nvidia:    { envBase: "NVIDIA_API_KEY",             maxSuffixed: 0,  authType: "BEARER" },
  local:     { envBase: "LOCAL_AI_DUMMY",             maxSuffixed: 0,  authType: "BEARER" },
}

let slots: Map<string, KeySlot[]> = new Map()
let counters: Map<string, number> = new Map()
let initialized = false

function detectGoogleType(value: string): KeyType {
  if (value.startsWith("AIzaSy")) return "API_KEY"
  if (value.startsWith("AQ.")) return "AUTH_TOKEN"
  return "API_KEY"
}

function loadSlots(): void {
  slots.clear()
  counters.clear()

  for (const [provider, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    const entries: KeySlot[] = []
    const seen = new Set<string>()

    const base = getApiKey(cfg.envBase)
    if (base && base.trim()) {
      seen.add(base.trim())
      entries.push({
        value: base.trim(),
        type: provider === "google" || provider === "google_image" ? detectGoogleType(base.trim()) : cfg.authType,
        provider,
        penalizedUntil: 0,
      })
    }

    for (let i = 1; i <= cfg.maxSuffixed; i++) {
      const val = process.env[`${cfg.envBase}_${i}`]
      if (val && val.trim() && !seen.has(val.trim())) {
        seen.add(val.trim())
        entries.push({
          value: val.trim(),
          type: provider === "google" || provider === "google_image" ? detectGoogleType(val.trim()) : cfg.authType,
          provider,
          penalizedUntil: 0,
        })
      }
    }

    slots.set(provider, entries)
    counters.set(provider, 0)
  }

  initialized = true
}

function getSlots(provider: string): KeySlot[] {
  if (!initialized) loadSlots()
  return slots.get(provider) ?? []
}

export function getNextKey(provider: string): KeySlot | null {
  if (provider === "local") {
    return { value: "local-no-auth", type: "BEARER", provider: "local", penalizedUntil: 0 }
  }
  const pool = getSlots(provider)
  if (pool.length === 0) return null

  const counter = counters.get(provider) ?? 0
  const now = Date.now()

  for (let attempt = 0; attempt < pool.length; attempt++) {
    const idx = (counter + attempt) % pool.length
    const slot = pool[idx]
    if (slot.penalizedUntil > now) continue
    counters.set(provider, idx + 1)
    console.log(`[KEY used ${idx + 1}/${pool.length}] ${provider}`)
    return slot
  }

  counters.set(provider, counter + 1)
  const fallbackIdx = counter % pool.length
  console.log(`[KEY used ${fallbackIdx + 1}/${pool.length}] ${provider} (all penalized, using fallback)`)
  return pool[fallbackIdx]
}

export function reportFailure(provider: string, status: number, keyValue: string, penaltyMs = 60_000): void {
  if (status !== 401 && status !== 403 && status !== 429) return
  const pool = getSlots(provider)
  for (const slot of pool) {
    if (slot.value === keyValue) {
      slot.penalizedUntil = Date.now() + penaltyMs
      console.log(`[key-router] Penalized ${provider} key for ${penaltyMs}ms (HTTP ${status})`)
      return
    }
  }
}

export function hasAnyKey(provider: string): boolean {
  return getSlots(provider).length > 0
}

export function getBaseUrl(provider: string, model: string, includeKey: boolean, keySlot: KeySlot | null): string {
  switch (provider) {
    case "google":
    case "google_image":
      if (keySlot && keySlot.type === "API_KEY") {
        return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keySlot.value}`
      }
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    case "groq":
      return `https://api.groq.com/openai/v1/chat/completions`
    case "openai":
      return `https://api.openai.com/v1/chat/completions`
    case "openrouter":
      return `https://openrouter.ai/api/v1/chat/completions`
    case "opencode":
      return `https://opencode.ai/zen/v1/chat/completions`
    case "xiaomi":
      return `https://api.xiaomimimo.com/v1/chat/completions`
    case "cerebras":
      return `https://api.cerebras.ai/v1/chat/completions`
    case "routeway":
      return `https://api.routeway.ai/v1/chat/completions`
    case "naga":
      return `https://api.naga.ac/v1/chat/completions`
    case "sambanova":
      return `https://api.sambanova.ai/v1/chat/completions`
    case "freetheai":
      return `https://api.freetheai.xyz/v1/chat/completions`
    case "cloudflare":
      return `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID ?? ""}/ai/v1/chat/completions`
    case "nvidia":
      return `https://integrate.api.nvidia.com/v1/chat/completions`
    case "local":
      return "http://127.0.0.1:8000/api/chat"
    case "ollama":
      return `https://ollama.com/api/chat`
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

export function buildAuthHeaders(provider: string, keySlot: KeySlot): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (provider === "local") return headers

  if (provider === "google" || provider === "google_image") {
    if (keySlot.type === "AUTH_TOKEN") {
      headers["x-goog-api-key"] = keySlot.value
    }
  } else {
    headers["Authorization"] = `Bearer ${keySlot.value}`
  }

  return headers
}

export function getModelForProvider(provider: string, model: string): string {
  if (provider === "groq") return model
  return model
}

export function resetPenalties(): void {
  for (const [, pool] of slots) {
    for (const slot of pool) {
      slot.penalizedUntil = 0
    }
  }
}

export function reloadKeys(): void {
  initialized = false
  loadSlots()
}
