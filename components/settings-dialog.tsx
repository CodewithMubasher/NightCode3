"use client"

import { useState } from "react"
import { X, Settings, Key, Box, Palette, Keyboard, Info, Monitor, Sun, Moon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"

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
  const [theme, setTheme] = useState("dark")
  const [enterSend, setEnterSend] = useState(true)
  const [sound, setSound] = useState(false)

  return (
    <div className="space-y-1">
      <SectionTitle>Preferences</SectionTitle>
      <Separator className="mb-2" />
      <SettingRow label="Theme" description="Choose your preferred appearance">
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button
            onClick={() => setTheme("dark")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
              theme === "dark"
                ? "bg-[var(--primary-color)]/10 text-[var(--primary-color)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Moon size={14} />
            Dark
          </button>
          <button
            onClick={() => setTheme("light")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
              theme === "light"
                ? "bg-[var(--primary-color)]/10 text-[var(--primary-color)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sun size={14} />
            Light
          </button>
          <button
            onClick={() => setTheme("system")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
              theme === "system"
                ? "bg-[var(--primary-color)]/10 text-[var(--primary-color)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Monitor size={14} />
            System
          </button>
        </div>
      </SettingRow>
      <Separator />
      <SettingRow label="Language" description="Interface language">
        <select className="h-8 w-32 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <option>English</option>
          <option>Urdu</option>
          <option>Spanish</option>
        </select>
      </SettingRow>
      <Separator />
      <SettingRow label="Enter to send" description="Press Enter to send, Shift+Enter for new line">
        <Switch checked={enterSend} onCheckedChange={setEnterSend} />
      </SettingRow>
      <Separator />
      <SettingRow label="Sound" description="Play sound on new messages">
        <Switch checked={sound} onCheckedChange={setSound} />
      </SettingRow>
    </div>
  )
}

function ApiKeysTab() {
  const providers = [
    { name: "OpenAI", key: "sk-...1234", env: "OPENAI_API_KEY" },
    { name: "OpenRouter", key: "sk-or-...5678", env: "OPENROUTER_API_KEY" },
    { name: "Google", key: "AIza...90ab", env: "GOOGLE_GENERATIVE_AI_API_KEY" },
    { name: "Groq", key: "gsk_...cdef", env: "GROQ_API_KEY" },
    { name: "xAI", key: "xai-...ghij", env: "XAI_API_KEY" },
    { name: "Naga", key: "naga-...klmn", env: "NAGA_API_KEY" },
    { name: "Cloudflare", key: "", env: "CLOUDFLARE_API_TOKEN" },
    { name: "DeepSeek", key: "sk-...opqr", env: "DEEPSEEK_API_KEY" },
  ]

  return (
    <div className="space-y-1">
      <SectionTitle>API Keys</SectionTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        Manage your provider API keys. Keys are stored locally and never shared.
      </p>
      <Separator className="mb-2" />
      <div className="space-y-3">
        {providers.map((p) => (
          <div key={p.name}>
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.env}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={p.key}
                  className="h-7 w-44 text-xs"
                  type="password"
                  placeholder="Enter API key"
                />
                <Button size="xs" variant="outline">
                  Save
                </Button>
              </div>
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
    <div className="space-y-1">
      <SectionTitle>Model Settings</SectionTitle>
      <Separator className="mb-2" />
      <SettingRow label="Default Model" description="Model used for new chats">
        <select className="h-8 w-44 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <option>big-pickle (OpenCode)</option>
          <option>gpt-4o (OpenAI)</option>
          <option>claude-3.5-sonnet (OpenRouter)</option>
          <option>gemini-2.5-flash (Google)</option>
          <option>llama-3.3-70b (Groq)</option>
        </select>
      </SettingRow>
      <Separator />
      <SettingRow label="Default Provider" description="Provider for new chats">
        <select className="h-8 w-44 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <option>opencode</option>
          <option>openai</option>
          <option>openrouter</option>
          <option>google</option>
          <option>groq</option>
        </select>
      </SettingRow>
      <Separator />
      <SettingRow label="Temperature" description="Controls randomness (0-2)">
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          defaultValue="0.7"
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-input accent-[var(--primary-color)]"
        />
      </SettingRow>
      <Separator />
      <SettingRow label="Max Tokens" description="Maximum response length">
        <select className="h-8 w-28 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <option>2048</option>
          <option>4096</option>
          <option>8192</option>
          <option>16384</option>
          <option>32768</option>
        </select>
      </SettingRow>
    </div>
  )
}

function AppearanceTab() {
  return (
    <div className="space-y-1">
      <SectionTitle>Appearance</SectionTitle>
      <Separator className="mb-2" />
      <SettingRow label="Font Size" description="UI text size">
        <select className="h-8 w-28 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <option>Small</option>
          <option selected>Medium</option>
          <option>Large</option>
        </select>
      </SettingRow>
      <Separator />
      <SettingRow label="Accent Color" description="Primary brand color">
        <div className="flex items-center gap-2">
          {["#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e"].map(
            (color) => (
              <button
                key={color}
                className="flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: color }}
              />
            )
          )}
        </div>
      </SettingRow>
      <Separator />
      <SettingRow label="Chat Density" description="Message spacing">
        <select className="h-8 w-28 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <option>Comfortable</option>
          <option selected>Compact</option>
        </select>
      </SettingRow>
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
