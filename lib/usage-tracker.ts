"use client"

import { getProviderLimits } from "./provider-limits"

const STORAGE_KEY = "nightcode-usage-logs"

export interface UsageEntry {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  timestamp: number
}

export interface ProviderModelStats {
  provider: string
  model: string
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningTokens: number
  totalTokens: number
  rpm: number
  tpm: number
  rpd: number
  tpd: number
  limitRpm: number | null
  limitRpd: number | null
  limitTpm: number | null
  limitTpd: number | null
}

function readLogs(): UsageEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as UsageEntry[]) : []
  } catch {
    return []
  }
}

function writeLogs(entries: UsageEntry[]): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    const trimmed = entries.slice(-1000)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch (e) { console.error("[usage] Failed to reset:", e) }
  }
}

function getStartOfTodayMs(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function getStartOfMinuteMs(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).getTime()
}

export function logUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): void {
  const entries = readLogs()
  entries.push({
    provider,
    model,
    inputTokens,
    outputTokens,
    reasoningTokens,
    timestamp: Date.now(),
  })
  writeLogs(entries)
}

export function getUsageSummary(): ProviderModelStats[] {
  const entries = readLogs()
  const todayStart = getStartOfTodayMs()
  const minuteStart = getStartOfMinuteMs()

  const map = new Map<string, ProviderModelStats>()

  for (const e of entries) {
    const key = `${e.provider}::${e.model}`
    let stats = map.get(key)
    if (!stats) {
      const limits = getProviderLimits(e.provider, e.model)
      stats = {
        provider: e.provider,
        model: e.model,
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalReasoningTokens: 0,
        totalTokens: 0,
        rpm: 0,
        tpm: 0,
        rpd: 0,
        tpd: 0,
        limitRpm: limits.rpm ?? null,
        limitRpd: limits.rpd ?? null,
        limitTpm: limits.tpm ?? null,
        limitTpd: limits.tpd ?? null,
      }
      map.set(key, stats)
    }

    stats.totalRequests++
    stats.totalInputTokens += e.inputTokens
    stats.totalOutputTokens += e.outputTokens
    stats.totalReasoningTokens += e.reasoningTokens
    stats.totalTokens += e.inputTokens + e.outputTokens + e.reasoningTokens

    if (e.timestamp >= minuteStart) {
      stats.rpm++
      stats.tpm += e.inputTokens + e.outputTokens + e.reasoningTokens
    }
    if (e.timestamp >= todayStart) {
      stats.rpd++
      stats.tpd += e.inputTokens + e.outputTokens + e.reasoningTokens
    }
  }

  return Array.from(map.values())
}
