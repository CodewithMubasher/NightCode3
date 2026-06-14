"use client"

import { useNightCodeStore } from "@/store/nightcode-store"
import { Palette } from "lucide-react"

const COLORS = ["#FFFFFF", "#FF8C00", "#14B8A6", "#8B5CF6"]

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ size?: number }>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#111] p-4">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon size={15} />
        {title}
      </h2>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const settings = useNightCodeStore((s) => s.settings)
  const setSettings = useNightCodeStore((s) => s.setSettings)

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize your NightCode appearance
        </p>
      </div>

      <Section icon={Palette} title="Appearance">
        <div>
          <label className="mb-3 block text-xs text-muted-foreground">Accent Color</label>
          <div className="flex gap-2.5">
            {COLORS.map((hex) => (
              <button
                key={hex}
                onClick={() => setSettings({ primaryColor: hex })}
                className="h-6 w-6 rounded-full border transition-transform hover:scale-110"
                style={{
                  background: hex,
                  borderColor: settings.primaryColor === hex ? hex : "rgba(255,255,255,0.15)",
                  outline: settings.primaryColor === hex ? `2px solid ${hex}` : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </Section>
    </div>
  )
}
