"use client"

import { X } from "lucide-react"
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, Maximize2Icon, RefreshCcwIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { WebPreview, WebPreviewBody, WebPreviewNavigation, WebPreviewNavigationButton, WebPreviewUrl } from "@/components/ai-elements/web-preview"
import { Button } from "@/components/ui/button"
import { useNightCodeStore } from "@/store/nightcode-store"

export function WebPreviewPanel() {
  const previewFilePath = useNightCodeStore((s) => s.previewFilePath)
  const isPreviewOpen = useNightCodeStore((s) => s.isPreviewOpen)
  const closePreview = useNightCodeStore((s) => s.closePreview)

  const [htmlContent, setHtmlContent] = useState("")
  const [url, setUrl] = useState("")
  const [fullscreen, setFullscreen] = useState(false)

  const loadFile = useCallback(async (filePath: string) => {
    try {
      const res = await fetch(`/api/preview?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) return
      const text = await res.text()
      setHtmlContent(text)
    } catch {}
  }, [])

  useEffect(() => {
    if (!previewFilePath || !isPreviewOpen) return
    setUrl(previewFilePath)
    loadFile(previewFilePath)
  }, [previewFilePath, isPreviewOpen, loadFile])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isPreviewOpen) closePreview()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [isPreviewOpen, closePreview])

  useEffect(() => {
    if (fullscreen) {
      document.documentElement.requestFullscreen?.()
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen?.()
      }
    }
  }, [fullscreen])

  if (!isPreviewOpen || !previewFilePath) return null

  return (
    <div className="flex h-screen flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
         style={{ flex: "7 1 0%" }}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <span className="text-sm font-semibold">Preview</span>
        <span className="max-w-[300px] truncate text-xs text-sidebar-foreground/60">{previewFilePath}</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={closePreview} aria-label="Close preview">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <WebPreview defaultUrl="">
          <WebPreviewNavigation>
            <WebPreviewNavigationButton onClick={() => {}} tooltip="Go back">
              <ArrowLeftIcon className="size-4" />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton onClick={() => {}} tooltip="Go forward">
              <ArrowRightIcon className="size-4" />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton
              onClick={() => previewFilePath && loadFile(previewFilePath)}
              tooltip="Reload"
            >
              <RefreshCcwIcon className="size-4" />
            </WebPreviewNavigationButton>
            <WebPreviewUrl
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.currentTarget as HTMLInputElement).value.trim()
                  if (val) loadFile(val)
                }
              }}
            />
            <WebPreviewNavigationButton
              onClick={() => window.open(`/api/preview?path=${encodeURIComponent(previewFilePath)}`, "_blank")}
              tooltip="Open in new tab"
            >
              <ExternalLinkIcon className="size-4" />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton
              onClick={() => setFullscreen((p) => !p)}
              tooltip={fullscreen ? "Exit fullscreen" : "Maximize"}
            >
              <Maximize2Icon className="size-4" />
            </WebPreviewNavigationButton>
          </WebPreviewNavigation>
          <WebPreviewBody srcDoc={htmlContent || undefined} />
        </WebPreview>
      </div>
    </div>
  )
}
