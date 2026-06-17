export interface ProviderLimits {
  rpm: number | null
  rpd: number | null
  tpm: number | null
  tpd: number | null
}

export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  groq: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  google: { rpm: 10, rpd: 1500, tpm: 250000, tpd: null },
  openrouter: { rpm: 20, rpd: 50, tpm: null, tpd: null },
  opencode: { rpm: 30, rpd: 200, tpm: null, tpd: null },
  ollama: { rpm: 15, rpd: 400, tpm: 100000, tpd: 250000 },
}
