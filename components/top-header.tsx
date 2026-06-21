"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useTheme } from "next-themes"
import { useNightCodeStore } from "@/store/nightcode-store"
import { FileText, Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentBody,
} from "@/components/ai-elements/context"
import { getUsageSummary, type ProviderModelStats } from "@/lib/usage-tracker"

function LimitBar({ current, limit, label }: { current: number; limit: number | null; label: string }) {
  const pct = limit && limit > 0 ? Math.min(current / limit, 1) : 0
  const color = pct >= 0.9 ? "bg-red-500" : pct >= 0.7 ? "bg-yellow-500" : "bg-[var(--primary-color)]"
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="h-1.5 rounded-full bg-muted">
        {limit != null && <div className={`h-full rounded-full ${color}`} style={{ width: `${pct * 100}%` }} />}
      </div>
      <span className="font-mono text-foreground">
        {current.toLocaleString()}{limit != null ? ` / ${limit.toLocaleString()}` : ""}
      </span>
    </div>
  )
}

function ProviderUsageSection() {
  const [stats, setStats] = React.useState<ProviderModelStats[]>([])

  React.useEffect(() => {
    function refresh() {
      setStats(getUsageSummary())
    }
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [])

  if (stats.length === 0) return null

  const byProvider = new Map<string, ProviderModelStats[]>()
  for (const s of stats) {
    const arr = byProvider.get(s.provider) ?? []
    arr.push(s)
    byProvider.set(s.provider, arr)
  }

  return (
    <div className="space-y-3 max-h-[300px] overflow-y-auto scrollbar-none">
      <span className="text-[11px] font-medium text-muted-foreground">Provider Rate Limits</span>
      {Array.from(byProvider.entries()).map(([provider, models]) => (
        <div key={provider}>
          <div className="mb-1.5 text-xs font-medium text-foreground">{provider}</div>
          <div className="space-y-1.5">
            {models.map((m) => (
              <div key={m.model} className="rounded-md bg-muted/50 p-2 text-[11px]">
                <div className="mb-1.5 font-medium text-foreground">{m.model}</div>
                <div className="space-y-1.5">
                  <LimitBar current={m.rpm} limit={m.limitRpm} label="RPM" />
                  <LimitBar current={m.tpm} limit={m.limitTpm} label="TPM" />
                  <LimitBar current={m.rpd} limit={m.limitRpd} label="RPD" />
                  <LimitBar current={m.tpd} limit={m.limitTpd} label="TPD" />
                </div>
                <div className="mt-1.5 flex justify-between text-muted-foreground">
                  <span>Total Requests</span>
                  <span className="font-mono text-foreground">{m.totalRequests}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function useTpdTotals(): [number, number] {
  const [totalReq, setTotalReq] = React.useState(0)
  const [totalRpd, setTotalRpd] = React.useState(0)

  React.useEffect(() => {
    function refresh() {
      const stats = getUsageSummary()
      let req = 0
      let rpd = 0
      const seenProviders = new Set<string>()
      for (const s of stats) {
        req += s.totalRequests
        if (!seenProviders.has(s.provider)) {
          if (s.limitRpd != null) rpd += s.limitRpd
          seenProviders.add(s.provider)
        }
      }
      setTotalReq(req)
      setTotalRpd(rpd)
    }
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [])

  return [totalReq, totalRpd]
}

export function TopHeader() {
  const { resolvedTheme, setTheme } = useTheme()
  const pathname = usePathname()
  const isChatPage = pathname.startsWith("/chat/")
  const activeChatId = useNightCodeStore((s) => s.activeChatId)
  const chats = useNightCodeStore((s) => s.chats)
  const projects = useNightCodeStore((s) => s.projects)
  const [totalReq, totalRpd] = useTpdTotals()
  const [hasStats, setHasStats] = React.useState(false)

  React.useEffect(() => {
    function refresh() {
      const stats = getUsageSummary()
      setHasStats(stats.length > 0)
    }
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [])

  const used = totalReq
  const max = totalRpd || 1

  const activeChat = activeChatId ? chats.find((c) => c.id === activeChatId) : null
  const contextProject = activeChat?.projectId ? projects.find((p) => p.id === activeChat.projectId) : null

  function togglePanel() {
    window.dispatchEvent(new CustomEvent("toggle-artifact-panel"))
  }

  return (
    <header className="sticky top-0 z-50 flex h-12 items-center gap-2 bg-background/10 px-2 sm:px-4 backdrop-blur-sm">
      <SidebarTrigger />
      <div className="flex flex-1" />
      {isChatPage && contextProject && (
        <span className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          <span>{contextProject.name}</span>
          <span className="text-muted-foreground/50">–</span>
          <span className="text-foreground">{activeChat!.title}</span>
        </span>
      )}
      <div className="flex flex-1" />
      <div className="flex items-center gap-1">
        <Context usedTokens={used} maxTokens={max}>
          <ContextTrigger />
          <ContextContent align="end" side="bottom" className="min-w-72">
            <ContextContentHeader />
            {hasStats && (
              <ContextContentBody>
                <ProviderUsageSection />
              </ContextContentBody>
            )}
          </ContextContent>
        </Context>
        <Button variant="ghost" size="icon-sm" onClick={togglePanel} aria-label="Toggle artifact panel">
          <FileText size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="hidden dark:block" size={16} />
          <Moon className="block dark:hidden" size={16} />
        </Button>
      </div>
    </header>
  )
}
