"use client"

import * as React from "react"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { useTheme } from "next-themes"
import { Gift, FileText, Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentBody,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
} from "@/components/ai-elements/context"
import { useNightCodeStore } from "@/store/nightcode-store"

const MODEL_MAX_TOKENS: Record<string, number> = {
  "big-pickle": 200000,
  "deepseek-v4-flash": 128000,
  "deepseek-v4-pro": 128000,
}

export function TopHeader() {
  const { resolvedTheme, setTheme } = useTheme()
  const { state: sidebarState } = useSidebar()
  const activeChat = useNightCodeStore((s) => {
    if (!s.activeChatId) return null
    return s.chats.find((c) => c.id === s.activeChatId) ?? null
  })

  const modelId = activeChat?.model ?? "big-pickle"
  const maxTokens = MODEL_MAX_TOKENS[modelId] ?? 128000
  const usedTokens = activeChat?.messages.reduce((acc, m) => acc + m.content.length, 0) ?? 0

  function togglePanel() {
    window.dispatchEvent(new CustomEvent("toggle-artifact-panel"))
  }

  return (
    <header className="sticky top-0 z-50 flex h-12 items-center gap-2 bg-background/10 px-4 backdrop-blur-sm">
      <SidebarTrigger />
      <div className="flex flex-1 justify-center">
        <div className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-muted/50 px-5 py-1.5 text-xs font-medium transition-colors hover:bg-muted">
          <Gift size={14} style={{ color: "#0099ff" }} />
          Upgrade for Free
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Context usedTokens={usedTokens} maxTokens={maxTokens} modelId={modelId}>
          <ContextTrigger />
          <ContextContent align="end" side="bottom">
            <ContextContentHeader />
            <ContextContentBody>
              <ContextInputUsage />
              <ContextOutputUsage />
              <ContextReasoningUsage />
            </ContextContentBody>
          </ContextContent>
        </Context>
        <Button variant="ghost" size="icon-sm" onClick={togglePanel}>
          <FileText size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden dark:block" size={16} />
          <Moon className="block dark:hidden" size={16} />
        </Button>
      </div>
    </header>
  )
}
