"use client"

import { useEffect, useCallback, useRef, useState, useMemo } from "react"
import { X, FileText, ChevronLeft, Download, Copy, Trash2 } from "lucide-react"
import { useNightCodeStore } from "@/store/nightcode-store"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { mermaid } from "@streamdown/mermaid"
import { math } from "@streamdown/math"
import { cjk } from "@streamdown/cjk"
import type { Artifact } from "@/types"

function normalizeMath(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, "$$\n$1\n$$")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1$")
    .replace(/(?<!\$)(\\begin\{[a-z]+\*?\}[\s\S]*?\\end\{[a-z]+\*?\})(?!\$)/g, "$$\n$1\n$$")
}

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
  const isStreaming = useNightCodeStore((s) => s.isStreaming)
  const [panelWidth, setPanelWidth] = useState(420)
  const [isOpen, setIsOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const isResizing = useRef(false)
  const [dbArtifacts, setDbArtifacts] = useState<Artifact[]>([])
  const prevStreaming = useRef(isStreaming)

  // FIX: Track the last message ID to detect when a new assistant message lands.
  // This is more reliable than watching chats (which fires on every text-delta)
  // or isStreaming (which fires before the DB write completes).
  const lastMessageId = useMemo(() => {
    const allMessages = chats.flatMap((c) => c.messages)
    return allMessages.at(-1)?.id ?? null
  }, [chats])

  const artifacts: Artifact[] = useMemo(() => {
    const fromStore = chats.flatMap((c) => c.messages.flatMap((m) => m.artifacts))
    const merged = new Map<string, Artifact>()
    for (const a of fromStore) merged.set(a.id, a)
    for (const a of dbArtifacts) if (!merged.has(a.id)) merged.set(a.id, a)
    return Array.from(merged.values())
  }, [dbArtifacts, chats])

  const fetchArtifacts = useCallback(() => {
    fetch("/api/artifacts")
      .then((r) => r.json())
      .then((data) => setDbArtifacts(data.artifacts ?? []))
      .catch(() => {})
  }, [])

  // Fetch on open (one-time, not on every chats update)
  useEffect(() => {
    if (isOpen) fetchArtifacts()
  }, [isOpen, fetchArtifacts])

  // FIX 1: Re-fetch when streaming stops — but add a small delay (300ms) so
  // the DB write from the tool has time to commit before we read it back.
  // The old code had no delay, so we raced the DB write.
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) {
      // Panel may be closed — still fetch so state is ready when user opens it
      const timer = setTimeout(() => fetchArtifacts(), 300)
      prevStreaming.current = isStreaming
      return () => clearTimeout(timer)
    }
    prevStreaming.current = isStreaming
  }, [isStreaming, fetchArtifacts])

  // FIX 2: Listen for the SSE "artifact" event the engine emits.
  // The route.ts already sends type:"artifact" via forwardToSSE → sessionEventToSSE.
  // We just need a custom window event listener here to react immediately
  // instead of waiting for the stream-end poll.
  // Your SSE client (wherever it parses events) should dispatch:
  //   window.dispatchEvent(new CustomEvent("nightcode:artifact", { detail: artifact }))
  // when it receives a type="artifact" SSE frame.
  useEffect(() => {
    function handleArtifactEvent(e: Event) {
      const artifact = (e as CustomEvent).detail as Artifact
      if (!artifact?.id) return
      setDbArtifacts((prev) => {
        if (prev.some((a) => a.id === artifact.id)) return prev
        return [...prev, artifact]
      })
      // Auto-open the panel and select the new artifact when one arrives
      setIsOpen(true)
      setActiveArtifactId(artifact.id)
    }
    window.addEventListener("nightcode:artifact", handleArtifactEvent)
    return () => window.removeEventListener("nightcode:artifact", handleArtifactEvent)
  }, [])

  // FIX 3: Also re-fetch when a new message lands (lastMessageId changes)
  // and the panel is already open. This catches artifacts from DB-only paths.
  const prevLastMessageId = useRef(lastMessageId)
  useEffect(() => {
    if (prevLastMessageId.current !== lastMessageId && isOpen) {
      // Small delay to let DB writes settle
      const timer = setTimeout(() => fetchArtifacts(), 500)
      prevLastMessageId.current = lastMessageId
      return () => clearTimeout(timer)
    }
    prevLastMessageId.current = lastMessageId
  }, [lastMessageId, isOpen, fetchArtifacts])

  const totalSize = artifacts.reduce((sum, a) => sum + a.content.length, 0)
  const storageLabel = totalSize > 1024 * 1024
    ? `${(totalSize / (1024 * 1024)).toFixed(1)} MB`
    : `${(totalSize / 1024).toFixed(1)} KB`

  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState("")
  const editRef = useRef<HTMLTextAreaElement>(null)
  const proseRef = useRef<HTMLDivElement>(null)

  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId)
  const showReader = isOpen && activeArtifactId !== null

  const artifactLocation = useMemo(() => {
    if (!activeArtifactId) return null
    for (const chat of chats) {
      for (const msg of chat.messages) {
        if (msg.artifacts.some((a) => a.id === activeArtifactId)) {
          return { chatId: chat.id, messageId: msg.id }
        }
      }
    }
    return null
  }, [activeArtifactId, chats])

  function handleDoubleClick() {
    if (!activeArtifact) return
    setEditContent(activeArtifact.content)
    setEditing(true)
    setTimeout(() => editRef.current?.focus(), 50)
  }

  function handleSave() {
    if (!activeArtifact) return
    const updated = { ...activeArtifact, content: editContent }
    if (artifactLocation) {
      useNightCodeStore.getState().upsertArtifact(
        artifactLocation.chatId,
        artifactLocation.messageId,
        updated
      )
    }
    fetch("/api/artifacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeArtifact.id, content: editContent }),
    })
    setDbArtifacts((prev) => prev.map((a) => a.id === activeArtifact.id ? updated : a))
    setEditing(false)
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setEditing(false) }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); handleSave() }
  }

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
              <Button variant="ghost" size="icon-sm" onClick={() => setActiveArtifactId(null)} aria-label="Back to artifact list">
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
                <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(activeArtifact.content)} aria-label="Copy artifact">
                  <Copy className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => handleDownload(activeArtifact)} aria-label="Download artifact">
                  <Download className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setIsOpen(false)} aria-label="Close artifact viewer">
                  <X className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">Artifacts ({artifacts.length})</span>
              <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setIsOpen(false)} aria-label="Close panel">
                <X className="size-4" />
              </Button>
            </>
          )}
        </div>

        {showReader && activeArtifact ? (
          <div className="flex-1 overflow-auto hide-scrollbar">
            <div className="px-6 py-5" onDoubleClick={handleDoubleClick}>
              {editing ? (
                <textarea
                  ref={editRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onBlur={handleSave}
                  onKeyDown={handleEditKeyDown}
                  className="w-full min-h-[300px] resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-relaxed text-[oklch(0.95_0_0)] outline-none font-sans hide-scrollbar"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
              ) : (
                <div
                  ref={proseRef}
                  onDoubleClick={handleDoubleClick}
                  className="min-w-0 cursor-default select-text"
                >
                  <Streamdown mode="static" className="nc-prose" plugins={{ code, mermaid, math, cjk }}>
                    {normalizeMath(activeArtifact.content)}
                  </Streamdown>
                </div>
              )}
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
                        fetch(`/api/artifacts?id=${artifact.id}`, { method: "DELETE" })
                        setDbArtifacts((prev) => prev.filter((a) => a.id !== artifact.id))
                        if (activeArtifactId === artifact.id) setActiveArtifactId(null)
                      }}
                      className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-red-400 group-hover:opacity-100"
                      aria-label="Delete artifact"
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