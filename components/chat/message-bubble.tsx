"use client"

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react"
import type { Message, ToolState } from "@/types"
import {
  Copy, Check, ThumbsUp, ThumbsDown, Eclipse, RotateCcw,
  CheckCircle2, ChevronDown, ChevronRight, Circle,
  FileText, FilePen, Terminal, Trash2, List, FolderCheck, BookOpen, Cable, Bot,
} from "lucide-react"
import {
  Attachments,
  Attachment,
  AttachmentPreview,
} from "@/components/ai-elements/attachments"
import { renderInlineMarkdown } from "@/lib/render-markdown"
import { cn } from "@/lib/utils"
import { useNightCodeStore } from "@/store/nightcode-store"
import { toast } from "sonner"

function toolIcon(toolName: string) {
  const mcpMatch = toolName.match(/^(.+?)_(.+)/)
  if (mcpMatch && !["read_file","write_file","list_directory","delete_file","execute_command","think","create_artifact","create_folder","search_files","skill","delegate_task","expert_agent"].includes(toolName)) {
    return Cable
  }
  switch (toolName) {
    case "read_file": return FileText
    case "write_file": return FilePen
    case "list_directory": return List
    case "delete_file": return Trash2
    case "execute_command": return Terminal
    case "create_artifact": return FilePen
    case "edit_artifact": return FilePen
    case "list_artifacts": return List
    case "read_artifact": return FileText
    case "create_folder": return FolderCheck
    case "skill": return BookOpen
    case "delegate_task": return Bot
    case "expert_agent": return Bot
    default: return Circle
  }
}

function toolArgs(toolState: ToolState): string | null {
  const path = toolState.args?.path as string | undefined
  if (path) return path
  const command = toolState.args?.command as string | undefined
  if (command) return command.length > 40 ? command.slice(0, 40) + "..." : command
  const thought = toolState.args?.thought as string | undefined
  if (thought) return thought.length > 40 ? thought.slice(0, 40) + "..." : thought
  const title = toolState.args?.title as string | undefined
  if (title) return title
  const slug = toolState.args?.slug as string | undefined
  if (slug) return slug
  const prompt = toolState.args?.prompt as string | undefined
  if (prompt) return prompt.length > 40 ? prompt.slice(0, 40) + "..." : prompt
  const focus = toolState.args?.focus as string | undefined
  if (focus && toolState.tool === "delegate_task") return focus
  const task = toolState.args?.task as string | undefined
  if (task && toolState.tool === "expert_agent") return task.length > 60 ? task.slice(0, 60) + "..." : task
  return null
}

function DelegateSummary({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [summary])

  return (
    <div className="mx-7 mt-2 mb-1 overflow-hidden rounded-md border border-white/10 bg-white/[0.03]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-[#999] transition-colors hover:bg-white/5"
      >
        <ChevronDown
          size={12}
          style={{
            transition: "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
        Sub-agent findings
      </button>
      <div
        style={{
          overflow: "hidden",
          transition: open ? "none" : "max-height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)",
          maxHeight: open ? `${contentHeight}px` : "0px",
          opacity: open ? 1 : 0,
        }}
      >
        <div ref={contentRef}>
          <div className="border-t border-white/10 px-2.5 py-2 text-[13px] leading-relaxed text-[#ccc]">
            {renderInlineMarkdown(summary)}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ToolTimelineItemProps {
  toolState: ToolState
  iconDelay?: number
}

function ToolTimelineItem({ toolState, iconDelay = 0 }: ToolTimelineItemProps) {
  const Icon = toolIcon(toolState.tool)
  const args = toolArgs(toolState)
  const isRunning = toolState.status === "running"
  const isFailed = toolState.status === "error" || toolState.status === "verification_failed"

  const iconColor = isFailed ? "#EF4444" : "#B3B3B3"
  const textColor = isFailed ? "#EF4444" : "#E0E0E0"

  const isFilePath = ["read_file", "write_file", "delete_file", "create_artifact", "edit_artifact", "read_artifact", "skill"].includes(toolState.tool)
  const isDelegate = toolState.tool === "delegate_task" || toolState.tool === "expert_agent"

  const toolLabels: Record<string, (a: string | null) => string> = {
    write_file: () => "Created",
    create_folder: () => "Created folder",
    delete_file: () => "Deleted",
    read_file: () => "Read",
    create_artifact: () => "Created Artifact",
    list_artifacts: () => "Listed artifacts",
    read_artifact: (a) => a ?? "Read artifact",
    edit_artifact: (a) => a ?? "Edited artifact",
    list_directory: (a) => a ? `Listed ${a}` : "Listed directory",
    search_files: () => "Searched files",
    execute_command: () => "Run command",
    think: () => "Thinking",
    skill: () => "Read skill",
    delegate_task: () => "Sub-agent",
    expert_agent: () => "Expert Agent",
  }
  const label = toolLabels[toolState.tool]?.(args) ?? (toolState.tool.startsWith("mcp_") ? "Use MCP" : toolState.tool)

  return (
    <div className="relative flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div className="relative z-10 flex shrink-0 items-center justify-center rounded-full bg-background" style={{ width: 22, height: 22 }}>
          <Icon className="size-3.5" style={{ color: isRunning && toolState.tool !== "create_artifact" ? "#10B981" : iconColor }} />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="text-[14px] font-sans" style={{ color: textColor }}>
            {label}
          </span>
          {args && isFilePath && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-sans cursor-default",
                toolState.tool === "write_file" && args.endsWith(".html") && "cursor-pointer hover:border-blue-500/40 hover:text-blue-400 transition-colors duration-150"
              )}
              onClick={() => {
                if (toolState.tool === "write_file" && args.endsWith(".html")) {
                  useNightCodeStore.getState().openPreview(args)
                }
              }}
              style={{
                background: "#1A1A1A",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#B3B3B3",
              }}
            >
              <FileText className="size-3" style={{ color: "#B3B3B3" }} />
              {args}
            </span>
          )}
          {args && !isFilePath && !isDelegate && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-sans"
              style={{
                background: "#1A1A1A",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#B3B3B3",
              }}
            >
              {args}
            </span>
          )}
          {isDelegate && args && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-sans"
              style={{
                background: "#1A1A1A",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#B3B3B3",
              }}
            >
              {args}
            </span>
          )}
        </div>
      </div>
      {isDelegate && toolState.result && typeof toolState.result.summary === "string" && (
        <DelegateSummary summary={toolState.result.summary} />
      )}
    </div>
  )
}

function Timeline({ toolStates, message }: { toolStates: Record<string, ToolState>; message: Message }) {
  const entries = Object.values(toolStates)
  if (entries.length === 0) return null

  const stagger = 150
  const lineDelay = entries.length * stagger + 200

  return (
    <div className="relative py-2">
      <div
        className="absolute left-[10px] top-2 bottom-2 w-px bg-white/10"
        style={{
          zIndex: 0,
          transformOrigin: "top",
          transform: "scaleY(0)",
          animation: "cinematic-line-draw 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards",
          animationDelay: `${lineDelay}ms`,
        }}
      />
      <div className="relative space-y-0" style={{ zIndex: 1 }}>
        {entries.map((ts, i) => (
          <div
            key={ts.id}
            className="pb-2"
            style={{
              opacity: 0,
              transform: "translateY(15px)",
              animation: "cinematic-step-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
              animationDelay: `${i * stagger}ms`,
            }}
          >
            <ToolTimelineItem toolState={ts} iconDelay={i * stagger + 60} />
          </div>
        ))}
        {message.status !== "streaming" && (
          <div
            className="flex items-center gap-1.5"
            style={{
              opacity: 0,
              transform: "translateY(10px)",
              animation: "cinematic-step-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
              animationDelay: `${entries.length * stagger + 100}ms`,
            }}
          >
            <div className="relative z-10 flex shrink-0 items-center justify-center rounded-full bg-background" style={{ width: 22, height: 22 }}>
              <CheckCircle2 className="size-3.5 text-emerald-500" />
            </div>
            <div className="flex min-w-0 flex-1 items-center">
              <span className="text-[14px] font-sans" style={{ color: "#B3B3B3" }}>Done</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const toolCount = Object.keys(message.toolStates).length
  const [copied, setCopied] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [spinKey, setSpinKey] = useState(0)
  const rollbackStore = useNightCodeStore((s) => s.rollbackToMessage)
  const activeChatId = useNightCodeStore((s) => s.activeChatId)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [message.content])

  const handleRollback = async () => {
    setSpinKey((k) => k + 1)
    setRollingBack(true)
    try {
      await fetch("/api/chat/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      })
      if (activeChatId) {
        rollbackStore(activeChatId, message.id)
      }
    } catch {
      // silent fail — button re-enables on next render
    } finally {
      setRollingBack(false)
    }
  }
  const isStreamingTool = message.status === "streaming" && toolCount > 0
  const [expanded, setExpanded] = useState(isStreamingTool)
  const timelineRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (isStreamingTool) setExpanded(true)
  }, [isStreamingTool])

  useLayoutEffect(() => {
    if (timelineRef.current) {
      setContentHeight(timelineRef.current.scrollHeight)
    }
  }, [message.toolStates])

  useLayoutEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContentHeight(el.scrollHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] space-y-2">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex justify-end">
              <Attachments variant="grid">
                {message.attachments.map((att) => (
                  <Attachment key={att.id} data={att as any}>
                    <AttachmentPreview />
                  </Attachment>
                ))}
              </Attachments>
            </div>
          )}

          <div className="rounded-2xl rounded-tr-sm bg-muted px-4 py-3 text-foreground tracking-wider"
               style={{ fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: 17, lineHeight: "24px", color: "rgb(227, 227, 227)" }}>
            <p>{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <style>{`
        @keyframes spin-once {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes thinking-shimmer {
          0%, 100% { background-position: 200% center; }
          50% { background-position: 0% center; }
        }
      `}</style>
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 items-center justify-center pt-1.5">
          <Eclipse size={24} style={{ color: "var(--primary-color)" }} className={message.status === "streaming" ? "animate-spin" : ""} />
        </div>
        <div className="min-w-0 flex-1 pt-1.5">
          {toolCount > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 py-1 text-sm font-sans text-[#B3B3B3] hover:text-white transition-colors duration-150"
            >
              Activities ({toolCount})
              <ChevronDown
                size={14}
                style={{
                  transition: "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
                  transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
                }}
              />
            </button>
          )}
          {message.status === "streaming" && toolCount === 0 && !message.content && (
            <div className="flex items-center gap-1.5 py-1">
              <span
                className="text-sm font-sans"
                style={{
                  background: "linear-gradient(90deg, #666, #999, #666)",
                  backgroundSize: "200% 100%",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  animation: "thinking-shimmer 2.5s ease-in-out infinite",
                }}
              >
                Thinking
              </span>
            </div>
          )}

          <div
            style={{
              overflow: "hidden",
              transition: `max-height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)`,
              maxHeight: expanded ? `${contentHeight}px` : "0px",
              opacity: expanded ? 1 : 0,
            }}
          >
            <div ref={timelineRef}>
              <Timeline toolStates={message.toolStates} message={message} />
            </div>
          </div>

          {message.content && (
            <div className="prose prose-invert max-w-none w-full min-w-0 mt-1 tracking-wider"
                 style={{ fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: 17, lineHeight: "24px", color: "rgb(227, 227, 227)" }}>
              {message.status === "streaming" ? message.content : renderInlineMarkdown(message.content)}
            </div>
          )}
          {message.status === "interrupted" && (
            <div className="mt-1 text-sm text-yellow-400 italic">This operation was interrupted</div>
          )}
          {message.hasError && (
            <div className="mt-1 text-sm text-red-400 italic">This response failed to generate</div>
          )}
          {message.status !== "streaming" && message.content && (
            <div className="mt-2 flex items-center gap-0.5">
              <button
                onClick={handleCopy}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Copy message"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
              <button
                onClick={() => toast.success("Thanks for the feedback!")}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Good response"
              >
                <ThumbsUp size={14} />
              </button>
              <button
                onClick={() => toast.success("Thanks for the feedback!")}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Bad response"
              >
                <ThumbsDown size={14} />
              </button>
              <button
                onClick={handleRollback}
                disabled={rollingBack}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                aria-label="Rollback to this point"
              >
                <RotateCcw
                  size={14}
                  key={spinKey}
                  className={rollingBack ? "animate-spin" : ""}
                  style={!rollingBack && spinKey > 0 ? { animation: "spin-once 0.4s ease-out", animationFillMode: "forwards" } : undefined}
                />
              </button>
              
            </div>
          )}
        </div>
      </div>
    </div>
  )
}