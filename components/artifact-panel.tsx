"use client"

import { useEffect, useCallback, useRef, useState } from "react"
import { X, FileText, ChevronLeft, Download, Copy, Trash2 } from "lucide-react"
import { useNightCodeStore } from "@/store/nightcode-store"
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
  const [panelWidth, setPanelWidth] = useState(420)
  const [isOpen, setIsOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const isResizing = useRef(false)

  const artifacts: Artifact[] = chats.flatMap((c) =>
    c.messages.flatMap((m) => m.artifacts)
  )

  const totalSize = artifacts.reduce((sum, a) => sum + a.content.length, 0)
  const storageLabel = totalSize > 1024 * 1024
    ? `${(totalSize / (1024 * 1024)).toFixed(1)} MB`
    : `${(totalSize / 1024).toFixed(1)} KB`

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
        "h-screen overflow-hidden border-l relative transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
        isOpen ? "border-l border-sidebar-border" : "w-0 border-l-0"
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
        className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
        style={{ width: panelWidth }}
      >
        <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border shrink-0">
          {showReader && activeArtifact ? (
            <>
              <Button variant="ghost" size="icon-sm" onClick={() => setActiveArtifactId(null)}>
                <ChevronLeft className="size-4" />
              </Button>
              <div className="flex flex-1 items-center justify-center min-w-0">
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-sans max-w-full"
                  style={{
                    background: "#1A1A1A",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#D1D1D1",
                  }}
                >
                  <span className="truncate max-w-[200px]">{activeArtifact.title}</span>
                  <span style={{ color: "#666" }}>·</span>
                  <span style={{ color: "#0099ff", flexShrink: 0 }}>{activeArtifact.type.toUpperCase()}</span>
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(activeArtifact.content)}>
                  <Copy className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => handleDownload(activeArtifact)}>
                  <Download className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setIsOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">Artifacts ({artifacts.length})</span>
              <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setIsOpen(false)}>
                <X className="size-4" />
              </Button>
            </>
          )}
        </div>

        {showReader && activeArtifact ? (
          <div className="flex-1 overflow-auto hide-scrollbar">
            <div className="px-6 py-5">
              <div className="[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-5 [&_h1:first-child]:mt-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-sidebar-border [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-2.5 [&_code]:rounded [&_code]:bg-sidebar-accent [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:font-mono [&_pre]:mb-3 [&_pre]:mt-1.5 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-sidebar-border [&_pre]:bg-[#0a0a0a] [&_pre]:p-3 [&_pre]:text-[11px] [&_pre]:font-mono [&_pre]:leading-relaxed [&_pre]:overflow-x-auto [&_ul]:mb-2.5 [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:mb-2.5 [&_ol]:mt-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-0.5 [&_blockquote]:mb-2.5 [&_blockquote]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-sidebar-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-sidebar-foreground/60 [&_blockquote]:text-sm [&_table]:w-full [&_table]:mb-3 [&_table]:border-collapse [&_th]:border [&_th]:border-sidebar-border [&_th]:px-2.5 [&_th]:py-1 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:bg-sidebar-accent [&_td]:border [&_td]:border-sidebar-border [&_td]:px-2.5 [&_td]:py-1 [&_td]:text-xs [&_hr]:my-5 [&_hr]:border-sidebar-border [&_a]:text-[#0099ff] [&_a]:hover:underline">
                {renderInlineMarkdown(activeArtifact.content)}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto hide-scrollbar">
            {artifacts.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-sidebar-foreground/60">
                No artifacts yet
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {artifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border border-sidebar-border transition-colors duration-150 group bg-sidebar-accent/40 hover:bg-sidebar-accent",
                      activeArtifactId === artifact.id && "border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.12)] hover:bg-[rgba(59,130,246,0.16)]"
                    )}
                  >
                    <button
                      onClick={() => setActiveArtifactId(artifact.id)}
                      className="flex flex-1 items-center gap-3 p-3 text-left cursor-pointer min-w-0"
                    >
                      <FileText className="size-4 shrink-0 text-sidebar-foreground/50" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-sidebar-foreground">
                          {artifact.title}
                        </div>
                        <div className="text-xs text-sidebar-foreground/50">
                          {artifact.type}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        useNightCodeStore.getState().deleteArtifact(artifact.id)
                        if (activeArtifactId === artifact.id) setActiveArtifactId(null)
                      }}
                      className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex h-12 items-center border-t border-sidebar-border px-4 shrink-0">
          <span className="text-xs text-sidebar-foreground/50">
            {totalSize > 0 ? `Storage used: ${storageLabel}` : "No artifacts"}
          </span>
        </div>
      </div>
    </div>
  )
}
