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
    document.documentElement.style.setProperty("--primary", settings.primaryColor)
  }, [settings.primaryColor])

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion)
  }, [settings.reducedMotion])

  useEffect(() => {
    if (resolvedTheme && settings.theme !== "system") {
      setSettings({ theme: resolvedTheme as "dark" | "light" | "system" })
    }
  }, [resolvedTheme, setSettings, settings.theme])

  return null
}
