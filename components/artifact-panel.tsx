"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { X, FileText, ChevronLeft, Download, Copy, Trash2 } from "lucide-react"
import { useNightCodeStore } from "@/store/nightcode-store"
import { useSidebar } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { renderInlineMarkdown } from "@/lib/render-markdown"
import type { Artifact } from "@/types"

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
  const chats = useNightCodeStore((s) => s.chats)
  const activeChatId = useNightCodeStore((s) => s.activeChatId)
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar()
  const sidebarWasOpen = useRef(sidebarOpen)
  const wasOpened = useRef(false)
  const [panelWidth, setPanelWidth] = useState(420)
  const [isOpen, setIsOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const isResizing = useRef(false)

  const activeChat = chats.find((c) => c.id === activeChatId)
  const artifacts: Artifact[] = activeChat
    ? activeChat.messages.flatMap((m) => m.artifacts)
    : []

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
      setIsOpen((prev) => !prev)
    }
    function handleToggle() {
      setIsOpen((prev) => !prev)
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("toggle-artifact-panel", handleToggle)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("toggle-artifact-panel", handleToggle)
    }
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
        <div className="flex h-14 items-center gap-2 px-4 border-b border-border/50 shrink-0">
          {showReader ? (
            <>
              <Button variant="ghost" size="icon-sm" onClick={() => setActiveArtifactId(null)}>
                <ChevronLeft className="size-4" />
              </Button>
              <div className="flex flex-1 items-center justify-center">
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-sans"
                  style={{
                    background: "#1A1A1A",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#D1D1D1",
                  }}
                >
                  {activeArtifact!.title}
                  <span style={{ color: "#666" }}>·</span>
                  <span style={{ color: "#0099ff" }}>{activeArtifact!.type.toUpperCase()}</span>
                </span>
              </div>
              <div className="ml-auto flex items-center gap-0.5">
                <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(activeArtifact!.content)}>
                  <Copy className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => handleDownload(activeArtifact!)}>
                  <Download className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setIsOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">Artifacts</span>
              <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setIsOpen(false)}>
                <X className="size-4" />
              </Button>
            </>
          )}
        </div>

        {showReader && activeArtifact ? (
          <div className="flex-1 overflow-auto hide-scrollbar">
            <div className="px-6 py-5">
              <div className="[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-5 [&_h1:first-child]:mt-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-border/20 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-2.5 [&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:font-mono [&_pre]:mb-3 [&_pre]:mt-1.5 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/50 [&_pre]:bg-[#0a0a0a] [&_pre]:p-3 [&_pre]:text-[11px] [&_pre]:font-mono [&_pre]:leading-relaxed [&_pre]:overflow-x-auto [&_ul]:mb-2.5 [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:mb-2.5 [&_ol]:mt-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-0.5 [&_blockquote]:mb-2.5 [&_blockquote]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:text-sm [&_table]:w-full [&_table]:mb-3 [&_table]:border-collapse [&_th]:border [&_th]:border-border/30 [&_th]:px-2.5 [&_th]:py-1 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:bg-muted/30 [&_td]:border [&_td]:border-border/30 [&_td]:px-2.5 [&_td]:py-1 [&_td]:text-xs [&_hr]:my-5 [&_hr]:border-border/20 [&_a]:text-[#0099ff] [&_a]:hover:underline">
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
                      "flex items-center gap-2 rounded-lg border border-white/10 transition-colors duration-150 group bg-muted/10 hover:bg-muted/30",
                      activeArtifactId === artifact.id && "border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.08)] hover:bg-[rgba(59,130,246,0.12)]"
                    )}
                  >
                    <button
                      onClick={() => setActiveArtifactId(artifact.id)}
                      className="flex flex-1 items-center gap-3 p-3 text-left cursor-pointer min-w-0"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {artifact.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {artifact.type}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (activeChatId) useNightCodeStore.getState().deleteArtifact(activeChatId, artifact.id)
                        if (activeArtifactId === artifact.id) setActiveArtifactId(null)
                      }}
                      className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-red-400 group-hover:opacity-100"
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
