"use client"

import { useNightCodeStore } from "@/store/nightcode-store"
import { Palette, MessageSquare, Volume2, Keyboard } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"

const COLORS = ["#FFFFFF", "#FF8C00", "#14B8A6", "#8B5CF6"]

export default function SettingsPage() {
  const settings = useNightCodeStore((s) => s.settings)
  const setSettings = useNightCodeStore((s) => s.setSettings)

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Customize your NightCode experience</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette size={16} />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-foreground">Theme</label>
                <p className="text-xs text-muted-foreground mt-0.5">Toggle between dark and light mode</p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant={settings.theme === "dark" ? "default" : "outline"}
                  onClick={() => setSettings({ theme: "dark" })}
                >
                  Dark
                </Button>
                <Button
                  size="xs"
                  variant={settings.theme === "light" ? "default" : "outline"}
                  onClick={() => setSettings({ theme: "light" })}
                >
                  Light
                </Button>
              </div>
            </div>
            <Separator />
            <div>
              <label className="text-sm text-foreground">Accent Color</label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">Choose your accent color</p>
              <div className="flex gap-3">
                {COLORS.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => setSettings({ primaryColor: hex })}
                    className="size-7 rounded-full border transition-transform hover:scale-110"
                    style={{
                      background: hex,
                      borderColor: settings.primaryColor === hex ? hex : "var(--border)",
                      outline: settings.primaryColor === hex ? `2px solid ${hex}` : "none",
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare size={16} />
            Chat
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-foreground">Default Model</label>
                <p className="text-xs text-muted-foreground mt-0.5">Model used for new chats</p>
              </div>
              <Input
                value={settings.defaultModel}
                onChange={(e) => setSettings({ defaultModel: e.target.value })}
                className="h-7 w-40 text-xs"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-foreground">Default Provider</label>
                <p className="text-xs text-muted-foreground mt-0.5">AI provider for new chats</p>
              </div>
              <Input
                value={settings.defaultProvider}
                onChange={(e) => setSettings({ defaultProvider: e.target.value })}
                className="h-7 w-40 text-xs"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-foreground">Temperature</label>
                <p className="text-xs text-muted-foreground mt-0.5">Controls randomness (0-1)</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(e) => setSettings({ temperature: parseFloat(e.target.value) })}
                  className="w-24 accent-[#008080]"
                />
                <span className="text-xs text-muted-foreground w-6 text-right">{settings.temperature}</span>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-foreground">Max Tokens</label>
                <p className="text-xs text-muted-foreground mt-0.5">Maximum response length</p>
              </div>
              <Input
                type="number"
                value={settings.maxTokens}
                onChange={(e) => setSettings({ maxTokens: parseInt(e.target.value) || 4096 })}
                className="h-7 w-24 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 size={16} />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-foreground">Sound Effects</label>
              <p className="text-xs text-muted-foreground mt-0.5">Play sounds on events</p>
            </div>
            <Switch
              checked={settings.soundEnabled}
              onCheckedChange={(v) => setSettings({ soundEnabled: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Keyboard size={16} />
            Input
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-foreground">Enter to Send</label>
              <p className="text-xs text-muted-foreground mt-0.5">Press Enter to send, Shift+Enter for newline</p>
            </div>
            <Switch
              checked={settings.enterToSend}
              onCheckedChange={(v) => setSettings({ enterToSend: v })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
