"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { useNightCodeStore } from "@/store/nightcode-store"

export function SettingsApplier() {
  const settings = useNightCodeStore((s) => s.settings)
  const setSettings = useNightCodeStore((s) => s.setSettings)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    document.documentElement.style.setProperty("--primary-color", settings.primaryColor)
  }, [settings.primaryColor])

  useEffect(() => {
    if (resolvedTheme) {
      setSettings({ theme: resolvedTheme as "dark" | "light" })
    }
  }, [resolvedTheme, setSettings])

  return null
}
