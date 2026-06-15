"use client"

import { useState, useEffect } from "react"
import type { Message, ToolState } from "@/types"
import {
  Copy, ThumbsUp, ThumbsDown, MoreHorizontal, Eclipse,
  CheckCircle2, ChevronDown, ChevronRight, Circle,
  FileText, FilePen, Terminal, Trash2, List, Brain, FolderCheck, BookOpen, Cable,
} from "lucide-react"
import {
  Attachments,
  Attachment,
  AttachmentPreview,
} from "@/components/ai-elements/attachments"
import { renderInlineMarkdown } from "@/lib/render-markdown"

function toolIcon(toolName: string) {
  const mcpMatch = toolName.match(/^(.+?)_(.+)/)
  if (mcpMatch && !["read_file","write_file","list_directory","delete_file","execute_command","think","create_artifact","create_folder","search_files","skill"].includes(toolName)) {
    return Cable
  }
  switch (toolName) {
    case "read_file": return FileText
    case "write_file": return FilePen
    case "list_directory": return List
    case "delete_file": return Trash2
    case "execute_command": return Terminal
    case "think": return Brain
    case "create_artifact": return FilePen
    case "create_folder": return FolderCheck
    case "skill": return BookOpen
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
  return null
}

interface ToolTimelineItemProps {
  toolState: ToolState
}

function ToolTimelineItem({ toolState }: ToolTimelineItemProps) {
  const Icon = toolIcon(toolState.tool)
  const args = toolArgs(toolState)
  const isRunning = toolState.status === "running"
  const isFailed = toolState.status === "error" || toolState.status === "verification_failed"

  const iconColor = isFailed ? "#EF4444" : "#B3B3B3"
  const textColor = isFailed ? "#EF4444" : "#E0E0E0"

  const isFilePath = ["read_file", "write_file", "delete_file", "create_artifact", "skill"].includes(toolState.tool)

  const toolLabels: Record<string, (a: string | null) => string> = {
    write_file: () => "Created",
    create_folder: () => "Created folder",
    delete_file: () => "Deleted",
    read_file: () => "Read",
    create_artifact: (a) => a ?? "Created document",
    list_directory: (a) => a ? `Listed ${a}` : "Listed directory",
    search_files: () => "Searched files",
    execute_command: (a) => a ? `Ran: ${a}` : "Ran command",
    think: () => "Thinking",
    skill: () => "Read skill",
  }
  const label = toolLabels[toolState.tool]?.(args) ?? (toolState.tool.startsWith("mcp_") ? "Use MCP" : toolState.tool)

  return (
    <div className="relative flex items-center gap-1.5">
      <div className="relative z-10 flex shrink-0 items-center justify-center rounded-full bg-background" style={{ width: 22, height: 22 }}>
        {isRunning ? (
          <div className="relative">
            <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(16,185,129,0.3)" }} />
            <Icon className="size-3.5 relative" style={{ color: iconColor }} />
          </div>
        ) : (
          <Icon className="size-3.5" style={{ color: iconColor }} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="text-[14px] font-sans" style={{ color: textColor }}>
          {label}
        </span>
        {args && isFilePath && (
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-sans"
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
        {args && !isFilePath && (
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
  )
}

function Timeline({ toolStates, message }: { toolStates: Record<string, ToolState>; message: Message }) {
  const entries = Object.values(toolStates)
  if (entries.length === 0) return null

  return (
    <div className="relative py-2">
      <div className="absolute left-[10px] top-2 bottom-2 w-px bg-white/10" style={{ zIndex: 0 }} />
      <div className="relative space-y-0" style={{ zIndex: 1 }}>
        {entries.map((ts) => (
          <div key={ts.id} className="pb-2">
            <ToolTimelineItem toolState={ts} />
          </div>
        ))}
        {message.status !== "streaming" && (
          <div className="flex items-center gap-1.5">
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
  const isStreamingTool = message.status === "streaming" && toolCount > 0
  const [expanded, setExpanded] = useState(isStreamingTool)

  useEffect(() => { if (isStreamingTool) setExpanded(true) }, [isStreamingTool])

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
          <div className="rounded-2xl rounded-tr-sm bg-muted px-4 py-2.5 text-base text-foreground">
            <p className="leading-relaxed">{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 items-center justify-center pt-1.5">
          <Eclipse size={24} style={{ color: "var(--primary-color)" }} className={message.status === "streaming" ? "animate-spin" : ""} />
        </div>
        <div className="min-w-0 flex-1 pt-1.5">
          {toolCount > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 py-1 text-sm font-sans text-[#B3B3B3] hover:text-white transition-colors"
            >
              Activities ({toolCount})
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}

          {expanded && <Timeline toolStates={message.toolStates} message={message} />}
          {message.content && (
            <div className="mt-1 text-base leading-relaxed" style={{ color: "#FFFFFF" }}>
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
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Copy size={14} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <ThumbsUp size={14} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <ThumbsDown size={14} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <MoreHorizontal size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
