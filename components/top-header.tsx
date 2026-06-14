"use client"

import * as React from "react"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { useTheme } from "next-themes"
import { Sun, Moon, Gift, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"

export function TopHeader() {
  const { resolvedTheme, setTheme } = useTheme()
  const { state: sidebarState } = useSidebar()

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
