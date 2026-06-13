"use client"

import { useEffect, useRef, useState } from "react"
import {
  Loader2,
  CheckCircle2,
  Circle,
  FileText,
  FileCode,
  FileJson,
  Terminal,
  FolderOpen,
  Trash2,
  FolderPlus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { Shimmer } from "@/components/ai-elements/shimmer"
import type { ToolCallEvent } from "@/types"

// ─── File pill (same as AgentTimeline) ────────────────────────────────────────

const fileIconMap: Record<string, typeof FileText> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
  css: FileCode, html: FileCode, py: FileCode, sql: FileCode,
  json: FileJson, yaml: FileCode, yml: FileCode, md: FileText,
}

function FilePill({ name }: { name: string }) {
  const ext = name.split(".").pop() || ""
  const Icon = fileIconMap[ext] || FileText
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-sans"
      style={{
        background: "#1A1A1A",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#D1D1D1",
      }}
    >
      <Icon className="size-3" style={{ color: "#0099ff" }} />
      {name}
    </span>
  )
}

// ─── Tool metadata ─────────────────────────────────────────────────────────────

const TOOL_META: Record<
  ToolCallEvent["tool"],
  { label: string; Icon: typeof FileText; getPath: (args: Record<string, unknown>) => string | null }
> = {
  read_file:        { label: "Reading",  Icon: FileText,   getPath: (a) => a.path as string },
  write_file:       { label: "Writing",  Icon: FileCode,   getPath: (a) => a.path as string },
  list_directory:   { label: "Listing",  Icon: FolderOpen, getPath: (a) => a.path as string },
  delete_file:      { label: "Deleting", Icon: Trash2,     getPath: (a) => a.path as string },
  execute_command:  { label: "Running",  Icon: Terminal,   getPath: (a) => a.command as string },
  create_directory: { label: "Creating", Icon: FolderPlus, getPath: (a) => a.path as string },
}

// ─── Single tool row — mirrors ActivityRow exactly ────────────────────────────

function ToolRow({ event, index }: { event: ToolCallEvent; index: number }) {
  const isActive    = event.status === "running"
  const isCompleted = event.status === "done"
  const isError     = event.status === "error"
  const meta        = TOOL_META[event.tool]
  const pathArg     = meta.getPath(event.args)
  const filename    = pathArg ? pathArg.split(/[\\/]/).pop() || pathArg : null

  return (
    <div
      className="group flex items-start gap-3 py-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Timeline dot — identical to AgentTimeline */}
      <div className="relative mt-[3px] shrink-0 size-[14px]">
        {isActive && (
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{ background: "rgba(16,185,129,0.2)" }}
          />
        )}
        <div className="relative flex size-full items-center justify-center">
          {isCompleted && <CheckCircle2 className="size-3.5 text-emerald-500" />}
          {isActive    && <Loader2 className="size-3.5 text-emerald-500 animate-spin" />}
          {isError     && <Circle className="size-3.5 text-red-400" />}
        </div>
      </div>

      {/* Label + file pill */}
      <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
        <span
          className={cn(
            "text-[15px] font-sans",
            isActive    && "text-white",
            isCompleted && "text-[#B3B3B3]",
            isError     && "text-[#6B6B6B]",
          )}
        >
          {meta.label}
        </span>
        {filename && <FilePill name={filename} />}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

interface BuildTimelineProps {
  events?: ToolCallEvent[]
  isStreaming?: boolean
}

export function BuildTimeline({ events, isStreaming }: BuildTimelineProps) {
  const [isOpen, setIsOpen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const safeEvents = events ?? []
  const allComplete = safeEvents.length > 0 && safeEvents.every((e) => e.status === "done")

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [safeEvents.length])

  // No events yet — just shimmer spinner
  if (safeEvents.length === 0 && isStreaming) {
    return (
      <div className="pb-2">
        <div className="flex items-center gap-2 py-1 animate-in fade-in-0 duration-500">
          <div className="size-[14px] relative mt-[3px] shrink-0">
            <div
              className="absolute inset-0 rounded-full animate-pulse"
              style={{ background: "rgba(16,185,129,0.2)" }}
            />
            <div className="relative flex size-full items-center justify-center">
              <Loader2 className="size-3.5 text-emerald-500 animate-spin" />
            </div>
          </div>
          <Shimmer duration={1.5} spread={3} className="text-[15px] font-sans">
            Building...
          </Shimmer>
        </div>
      </div>
    )
  }

  // Finished with no events
  if (safeEvents.length === 0 && !isStreaming) {
    return (
      <div className="pb-2">
        <div className="flex items-center gap-2 py-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <CheckCircle2 className="size-3.5 text-emerald-500" />
          <span className="text-[13px] font-sans" style={{ color: "#999999" }}>
            Build completed
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-2">
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-0">

        {/* Header — same as "Planning... (6)" */}
        <CollapsibleTrigger
          className="flex items-center gap-2 text-[15px] font-sans cursor-pointer select-none group py-1"
          style={{ color: "#CCCCCC" }}
        >
          {isStreaming && !allComplete ? (
            <Shimmer duration={1.5} spread={3} className="text-[15px] font-sans font-medium">
              Building...
            </Shimmer>
          ) : (
            <span className="font-medium" style={{ color: "#CCCCCC" }}>Building...</span>
          )}
          <span className="text-[13px]" style={{ color: "#AAAAAA" }}>
            ({safeEvents.length})
          </span>
          {isStreaming && !allComplete && (
            <div
              className="size-1.5 rounded-full animate-pulse shrink-0"
              style={{ background: "rgba(16,185,129,0.6)" }}
            />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="relative">
            {/* Vertical line — same as AgentTimeline */}
            <div
              className="absolute left-[6px] top-2 bottom-2 w-px"
              style={{ background: "rgba(255,255,255,0.08)" }}
            />
            <div className="space-y-0">
              {safeEvents.map((event, idx) => (
                <ToolRow key={event.id} event={event} index={idx} />
              ))}
            </div>
          </div>
          <div ref={bottomRef} />
        </CollapsibleContent>

      </Collapsible>
    </div>
  )
}
