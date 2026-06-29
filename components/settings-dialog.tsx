"use client"

import { useState, useEffect, useCallback } from "react"
import { X, Settings, Key, Box, Palette, Keyboard, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type SettingsTab = "general" | "api-keys" | "models" | "appearance" | "keybindings" | "about"

const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "models", label: "Models", icon: Box },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "keybindings", label: "Keybindings", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
]

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general")

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-[95vw] overflow-hidden rounded-xl bg-card shadow-xl ring-1 ring-foreground/10 md:h-[580px] md:max-w-[720px]"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-[140px] shrink-0 flex-col border-r border-border md:w-[172px]">
          <div className="flex items-center justify-between px-3 py-[14px] md:px-4 md:py-[18px]">
            <h2 className="text-xs font-semibold text-foreground md:text-sm">Settings</h2>
          </div>
          <nav className="flex flex-col gap-0.5 px-1.5 md:px-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors md:gap-2.5 md:px-3 md:py-2 md:text-sm",
                  activeTab === tab.id
                    ? "bg-[var(--primary-color)]/10 font-medium text-[var(--primary-color)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <tab.icon size={16} />
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 md:px-6 md:py-[14px]">
            <h3 className="text-xs font-medium text-foreground md:text-sm">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close settings"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
            {activeTab === "general" && <GeneralTab />}
            {activeTab === "api-keys" && <ApiKeysTab />}
            {activeTab === "models" && <ModelsTab />}
            {activeTab === "appearance" && <AppearanceTab />}
            {activeTab === "keybindings" && <KeybindingsTab />}
            {activeTab === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1 text-sm font-semibold text-foreground">{children}</h4>
  )
}

function GeneralTab() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <p className="text-lg font-medium">Coming Soon</p>
      <p className="text-sm mt-1">Settings are not yet available.</p>
    </div>
  )
}

function ApiKeysTab() {
  const [providers, setProviders] = useState<{ env_name: string; display_name: string; account_label: string }[]>([])
  const [allAccounts, setAllAccounts] = useState<string[]>([])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/keys")
      if (!res.ok) return
      const data = await res.json()
      setProviders(data.providers)
      setAllAccounts(data.accounts)
    } catch {}
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleChange = (env_name: string, account_label: string) => {
    fetch("/api/keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env_name, account_label }),
    })
    setProviders((prev) =>
      prev.map((p) => (p.env_name === env_name ? { ...p, account_label } : p))
    )
  }

  return (
    <div className="space-y-1">
      <SectionTitle>API Keys</SectionTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        Select which account's key to use for each provider.
      </p>
      <Separator className="mb-2" />
      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.env_name}>
            <div className="flex items-center justify-between gap-4 py-1.5">
              <div>
                <p className="text-sm text-foreground">{p.display_name}</p>
                <p className="text-[10px] text-muted-foreground">{p.env_name}</p>
              </div>
              <Select
                value={p.account_label}
                onValueChange={(v) => handleChange(p.env_name, v)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allAccounts.map((acc) => (
                    <SelectItem key={acc} value={acc}>{acc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
          </div>
        ))}
      </div>
    </div>
  )
}

function ModelsTab() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <p className="text-lg font-medium">Coming Soon</p>
      <p className="text-sm mt-1">Settings are not yet available.</p>
    </div>
  )
}

function AppearanceTab() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <p className="text-lg font-medium">Coming Soon</p>
      <p className="text-sm mt-1">Settings are not yet available.</p>
    </div>
  )
}

function KeybindingsTab() {
  const shortcuts = [
    { key: "Ctrl + K", action: "Command palette" },
    { key: "Ctrl + N", action: "New chat" },
    { key: "Ctrl + Shift + P", action: "Projects" },
    { key: "Ctrl + ,", action: "Open settings" },
    { key: "Ctrl + /", action: "Toggle sidebar" },
    { key: "Escape", action: "Close modal / Cancel" },
    { key: "Ctrl + Enter", action: "Send message (when Enter-to-send off)" },
    { key: "Ctrl + Shift + A", action: "Toggle artifacts panel" },
  ]

  return (
    <div className="space-y-1">
      <SectionTitle>Keyboard Shortcuts</SectionTitle>
      <Separator className="mb-2" />
      <div className="space-y-1">
        {shortcuts.map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
          >
            <span className="text-sm text-foreground">{s.action}</span>
            <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {s.key}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}

function AboutTab() {
  return (
    <div className="space-y-1">
      <SectionTitle>About NightCode</SectionTitle>
      <Separator className="mb-2" />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--primary-color)]/10 text-sm font-bold text-[var(--primary-color)]">
              N
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">NightCode</p>
              <p className="text-xs text-muted-foreground">Version 0.1.0</p>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            An AI-powered code assistant built with Next.js. Connect your preferred
            AI providers and work smarter.
          </p>
        </div>

        <div className="space-y-2">
          <SettingRow label="License" description="MIT">
            <span className="text-sm text-muted-foreground">MIT</span>
          </SettingRow>
          <Separator />
          <SettingRow label="Repository" description="Source code">
            <Button size="xs" variant="outline" asChild>
              <a href="https://github.com" target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </Button>
          </SettingRow>
          <Separator />
          <SettingRow label="Report Issue" description="Found a bug?">
            <Button size="xs" variant="outline" asChild>
              <a href="https://github.com" target="_blank" rel="noreferrer">
                File an Issue
              </a>
            </Button>
          </SettingRow>
        </div>
      </div>
    </div>
  )
}
