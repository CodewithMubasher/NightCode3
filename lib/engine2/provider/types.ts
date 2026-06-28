export type KeyStatus = "healthy" | "cooldown" | "dead"
export type AuthType = "API_KEY" | "AUTH_TOKEN" | "BEARER"

export interface KeySlot {
  value: string
  type: AuthType
  provider: string
  label?: string
}

export interface ProviderConfig {
  name: string
  keyEnvBase: string
  maxKeys: number
  maxContext: number
  rpmLimit: number
  tpmLimit: number
  rpdLimit: number
  tpdLimit: number
  cooldownMs: number
  deadAfterFailures: number
  timeoutMs: number
  baseUrl: string
  authType: AuthType
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  google: {
    name: "Google", keyEnvBase: "GOOGLE_GENERATIVE_AI_API_KEY", maxKeys: 10,
    maxContext: 1_000_000, rpmLimit: 360, tpmLimit: 4_000_000, rpdLimit: 1500, tpdLimit: 50_000_000,
    cooldownMs: 60_000, deadAfterFailures: 5, timeoutMs: 60_000,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/", authType: "API_KEY",
  },
  groq: {
    name: "Groq", keyEnvBase: "GROQ_API_KEY", maxKeys: 10,
    maxContext: 128_000, rpmLimit: 30, tpmLimit: 15_000, rpdLimit: 1000, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://api.groq.com/openai/v1/chat/completions", authType: "BEARER",
  },
  openai: {
    name: "OpenAI", keyEnvBase: "OPENAI_API_KEY", maxKeys: 1,
    maxContext: 200_000, rpmLimit: 500, tpmLimit: 200_000, rpdLimit: 10000, tpdLimit: 100_000_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 60_000,
    baseUrl: "https://api.openai.com/v1/chat/completions", authType: "BEARER",
  },
  openrouter: {
    name: "OpenRouter", keyEnvBase: "OPENROUTER_API_KEY", maxKeys: 4,
    maxContext: 200_000, rpmLimit: 20, tpmLimit: 40_000, rpdLimit: 200, tpdLimit: 200_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://openrouter.ai/api/v1/chat/completions", authType: "BEARER",
  },
  opencode: {
    name: "OpenCode", keyEnvBase: "OPENCODE_API_KEY", maxKeys: 1,
    maxContext: 200_000, rpmLimit: 100, tpmLimit: 100_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions", authType: "BEARER",
  },
  ollama: {
    name: "Ollama", keyEnvBase: "OLLAMA_CLOUD_API_KEY", maxKeys: 1,
    maxContext: 128_000, rpmLimit: 30, tpmLimit: 30_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://ollama.com/api/chat", authType: "BEARER",
  },
  xiaomi: {
    name: "Xiaomi", keyEnvBase: "XIAOMI_API_KEY", maxKeys: 1,
    maxContext: 128_000, rpmLimit: 60, tpmLimit: 30_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://api.xiaomimimo.com/v1/chat/completions", authType: "BEARER",
  },
  cerebras: {
    name: "Cerebras", keyEnvBase: "CEREBRAS_API_KEY", maxKeys: 1,
    maxContext: 8_000, rpmLimit: 30, tpmLimit: 15_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://api.cerebras.ai/v1/chat/completions", authType: "BEARER",
  },
  naga: {
    name: "Naga", keyEnvBase: "NAGA_API_KEY", maxKeys: 1,
    maxContext: 128_000, rpmLimit: 30, tpmLimit: 15_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://api.naga.ac/v1/chat/completions", authType: "BEARER",
  },
  sambanova: {
    name: "SambaNova", keyEnvBase: "SAMBANOVA_API_KEY", maxKeys: 1,
    maxContext: 128_000, rpmLimit: 30, tpmLimit: 15_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://api.sambanova.ai/v1/chat/completions", authType: "BEARER",
  },
  freetheai: {
    name: "FreeTheAI", keyEnvBase: "FREETHEAI_API_KEY", maxKeys: 1,
    maxContext: 128_000, rpmLimit: 30, tpmLimit: 15_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://api.freetheai.xyz/v1/chat/completions", authType: "BEARER",
  },
  cloudflare: {
    name: "Cloudflare", keyEnvBase: "CLOUDFLARE_API_TOKEN", maxKeys: 1,
    maxContext: 32_000, rpmLimit: 50, tpmLimit: 50_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/", authType: "BEARER",
  },
  nvidia: {
    name: "NVIDIA", keyEnvBase: "NVIDIA_API_KEY", maxKeys: 1,
    maxContext: 128_000, rpmLimit: 30, tpmLimit: 15_000, rpdLimit: 500, tpdLimit: 500_000,
    cooldownMs: 60_000, deadAfterFailures: 3, timeoutMs: 30_000,
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions", authType: "BEARER",
  },
  local: {
    name: "Local", keyEnvBase: "LOCAL_AI_DUMMY", maxKeys: 1,
    maxContext: 128_000, rpmLimit: 1000, tpmLimit: 1_000_000, rpdLimit: 10000, tpdLimit: 10_000_000,
    cooldownMs: 10_000, deadAfterFailures: 3, timeoutMs: 120_000,
    baseUrl: "", authType: "BEARER",
  },
}

export const OPENAI_COMPATIBLE = new Set([
  "groq", "openai", "openrouter", "opencode", "xiaomi",
  "cerebras", "naga", "sambanova", "freetheai", "cloudflare", "nvidia",
])

export function getToken(tag: string): string {
  return process.env[tag] ?? ""
}

export function getBaseUrl(providerName: string, model: string, keyValue: string): string {
  const cfg = PROVIDER_CONFIGS[providerName]
  if (!cfg) throw new Error(`Unknown provider: ${providerName}`)

  if (providerName === "google") {
    const base = cfg.baseUrl
    return `${base}${model}:generateContent?key=${keyValue}`
  }
  if (providerName === "local") {
    return process.env.LOCAL_AI_URL || "http://127.0.0.1:8000/api/chat"
  }
  if (providerName === "cloudflare") {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? ""
    return `${cfg.baseUrl}${accountId}/ai/v1/chat/completions`
  }
  return cfg.baseUrl
}
