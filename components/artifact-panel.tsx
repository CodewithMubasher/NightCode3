"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { X, FileText, ChevronLeft, Download, Copy, Trash2 } from "lucide-react"
import { useArtifactStore, type Artifact } from "@/store/artifact-store"
import { useSidebar } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { renderInlineMarkdown } from "@/lib/render-markdown"

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

export function ArtifactPanel() {
  const { isOpen, artifacts, activeArtifactId, closePanel, setActiveArtifact, deleteArtifact } =
    useArtifactStore()
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar()
  const sidebarWasOpen = useRef(sidebarOpen)
  const wasOpened = useRef(false)
  const [panelWidth, setPanelWidth] = useState(420)
  const isResizing = useRef(false)

  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId)
  const showReader = isOpen && activeArtifactId !== null

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const newWidth = window.innerWidth - e.clientX
      setPanelWidth(Math.max(280, Math.min(800, newWidth)))
    }
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }
    }
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      wasOpened.current = true
      sidebarWasOpen.current = sidebarOpen
      setSidebarOpen(false)
    } else if (wasOpened.current) {
      wasOpened.current = false
      setSidebarOpen(sidebarWasOpen.current)
    }
  }, [isOpen, sidebarOpen, setSidebarOpen])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "a" || !(e.metaKey || e.ctrlKey)) return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      useArtifactStore.getState().togglePanel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
    } catch {}
  }, [])

  const handleDownload = useCallback((artifact: Artifact) => {
    const ext = artifact.title.endsWith(".md") ? "md" : artifact.title.endsWith(".json") ? "json" : "txt"
    const blob = new Blob([artifact.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${artifact.title.replace(/\.[^.]+$/, "")}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const timeAgo = (() => {
    const mins = Math.floor((Date.now() - 0) / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins} min ago`
    const hours = Math.floor(mins / 60)
    return `${hours}h ago`
  })()

  return (
    <div
      className={cn(
        "h-screen overflow-hidden border-l relative transition-all duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]",
        isOpen ? "border-l" : "w-0 border-l-0"
      )}
      style={{ width: isOpen ? panelWidth : 0 }}
    >
      {isOpen && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 z-10"
        />
      )}

      <div
        className="flex h-full flex-col bg-background text-foreground"
        style={{ width: panelWidth }}
      >
        <div className="flex h-14 items-center justify-between px-4 border-b border-border/50 shrink-0">
          {showReader ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setActiveArtifact(null)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(activeArtifact!.content)}>
                  <Copy className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => handleDownload(activeArtifact!)}>
                  <Download className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={closePanel}>
                  <X className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">Artifacts</span>
              <Button variant="ghost" size="icon-sm" onClick={closePanel}>
                <X className="size-4" />
              </Button>
            </>
          )}
        </div>

        {showReader && activeArtifact ? (
          <div className="flex-1 overflow-auto hide-scrollbar">
            <div className="mx-auto max-w-[900px] px-6 py-8">
              <div className="[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-6 [&_h1:first-child]:mt-0 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-border/20 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_p]:text-base [&_p]:leading-relaxed [&_p]:mb-3 [&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_pre]:mb-4 [&_pre]:mt-2 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/50 [&_pre]:bg-[#0a0a0a] [&_pre]:p-3.5 [&_pre]:text-xs [&_pre]:font-mono [&_pre]:leading-relaxed [&_pre]:overflow-x-auto [&_ul]:mb-3 [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5 [&_ol]:mb-3 [&_ol]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-0.5 [&_blockquote]:mb-3 [&_blockquote]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_table]:w-full [&_table]:mb-4 [&_table]:border-collapse [&_th]:border [&_th]:border-border/30 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_th]:bg-muted/30 [&_td]:border [&_td]:border-border/30 [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-sm [&_hr]:my-6 [&_hr]:border-border/20 [&_a]:text-[#0099ff] [&_a]:hover:underline">
                {renderInlineMarkdown(activeArtifact.content)}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto hide-scrollbar">
            {artifacts.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No artifacts yet
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {artifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg transition-colors duration-150 group",
                      activeArtifactId === artifact.id && "bg-[rgba(59,130,246,0.08)]"
                    )}
                  >
                    <button
                      onClick={() => setActiveArtifact(artifact.id)}
                      className="flex flex-1 items-center gap-3 p-3 text-left cursor-pointer"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {artifact.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {artifact.type} &bull; {timeAgo}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => deleteArtifact(artifact.id)}
                      className="shrink-0 mr-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex h-12 items-center border-t border-border/50 px-4 shrink-0">
          <span className="text-xs text-muted-foreground">
            {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  )
}
