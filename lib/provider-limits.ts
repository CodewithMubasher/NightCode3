export interface ProviderLimits {
  rpm: number | null
  rpd: number | null
  tpm: number | null
  tpd: number | null
}

export const MODEL_LIMITS: Record<string, Record<string, ProviderLimits>> = {
  google: {
    "gemini-2.5-flash": { rpm: 10, rpd: 250, tpm: 250000, tpd: null },
    "gemini-2.5-pro":   { rpm: 5,  rpd: 100, tpm: 250000, tpd: null },
  },
  groq: {
    "llama-3.1-8b-instant":     { rpm: 30, rpd: 14400, tpm: 6000,  tpd: 500000 },
    "llama-3.3-70b-versatile":  { rpm: 30, rpd: 1000,  tpm: 12000, tpd: 100000 },
    "mixtral-8x7b-32768":       { rpm: 30, rpd: 14400, tpm: 6000,  tpd: 500000 },
  },
  cerebras: {
    "gpt-oss-120b": { rpm: 30, rpd: 1440, tpm: 8000, tpd: 1000000 },
    "z-ai-glm-4-7": { rpm: 10, rpd: 100,  tpm: null, tpd: 1000000 },
  },
}

export function getProviderLimits(provider: string, model: string): ProviderLimits {
  const modelLimits = MODEL_LIMITS[provider]?.[model]
  if (modelLimits) return modelLimits

  const fallback: Record<string, ProviderLimits> = {
    groq:       { rpm: 30,  rpd: 1000,   tpm: 8000,    tpd: 200000 },
    google:     { rpm: 10,  rpd: 1500,   tpm: 250000,  tpd: null },
    openrouter: { rpm: 20,  rpd: 50,     tpm: null,    tpd: null },
    opencode:   { rpm: 20,  rpd: 500,    tpm: 150000,  tpd: 5000000 },
    ollama:     { rpm: 15,  rpd: 400,    tpm: 100000,  tpd: 250000 },
    xiaomi:     { rpm: 20,  rpd: 100,    tpm: 100000,  tpd: null },
    routeway:   { rpm: 10,  rpd: 100,    tpm: null,    tpd: null },
    naga:       { rpm: 15,  rpd: 120,    tpm: 40000,   tpd: 150000 },
    sambanova:  { rpm: 30,  rpd: 1000,   tpm: 80000,   tpd: 2000000 },
    cloudflare: { rpm: 300, rpd: 100,    tpm: null,    tpd: null },
  }

  return fallback[provider] ?? { rpm: null, rpd: null, tpm: null, tpd: null }
}
