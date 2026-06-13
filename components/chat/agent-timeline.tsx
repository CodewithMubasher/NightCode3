"use client"

import { useEffect, useRef, useState } from "react"
import {
  Loader2,
  CheckCircle2,
  Circle,
  FileText,
  FileCode,
  FileJson,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { TimelineActivity } from "@/store/timeline-store"
import { useTimelineStore } from "@/store/timeline-store"
import { useArtifactStore } from "@/store/artifact-store"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"

const fileIconMap: Record<string, typeof FileText> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  css: FileCode,
  html: FileCode,
  py: FileCode,
  sql: FileCode,
  json: FileJson,
  yaml: FileCode,
  yml: FileCode,
  md: FileText,
}

function FilePill({ file, onClick }: { file: { name: string; type: string }; onClick?: () => void }) {
  const Icon = fileIconMap[file.type] || FileText

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-sans cursor-pointer transition-colors hover:bg-white/10"
      style={{
        background: "#1A1A1A",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#D1D1D1",
      }}
    >
      <Icon className="size-3" style={{ color: "#0099ff" }} />
      {file.name}
    </button>
  )
}

function ActivityRow({
  activity,
  index,
}: {
  activity: TimelineActivity
  index: number
}) {
  const isActive = activity.status === "in_progress"
  const isCompleted = activity.status === "completed"
  const isPending = activity.status === "pending"
  const openPanel = useArtifactStore((s) => s.openPanel)
  const artifacts = useArtifactStore((s) => s.artifacts)

  return (
    <div
      className="group flex items-start gap-3 py-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Timeline dot */}
      <div className="relative mt-[3px] shrink-0 size-[14px]">
        {isActive && (
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{ background: "rgba(16,185,129,0.2)" }}
          />
        )}
        <div className="relative flex size-full items-center justify-center">
          {isCompleted && (
            <CheckCircle2 className="size-3.5 text-emerald-500" />
          )}
          {isActive && (
            <Loader2 className="size-3.5 text-emerald-500 animate-spin" />
          )}
          {isPending && <Circle className="size-3.5" color="#B3B3B3" />}
        </div>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
        <span
          className={cn(
            "truncate text-[15px] font-sans",
            isActive && "text-white",
            isCompleted && "text-[#B3B3B3]",
            isPending && "text-[#6B6B6B]"
          )}
        >
          {(() => {
            if (activity.fileReference) {
              const withoutFile = activity.title
                .replace(activity.fileReference.name, "")
                .trim()
                .replace(/\s+$/, "")
              return withoutFile || "Generated"
            }
            return activity.title
          })()}
        </span>

        {activity.fileReference && (
          <FilePill
            file={activity.fileReference}
            onClick={() => {
              if (activity.artifactId) {
                const artifact = artifacts.find((a) => a.id === activity.artifactId)
                if (artifact) openPanel(artifact)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}

export function AgentTimeline({
  isStreaming,
  events: propEvents,
}: {
  isStreaming?: boolean
  events?: TimelineActivity[]
}) {
  const globalEvents = useTimelineStore((s) => s.events)
  const events = propEvents ?? globalEvents
  const [isOpen, setIsOpen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const allComplete = events.every((e) => e.status === "completed")

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events.length])

  if (events.length === 0 && !isStreaming) {
    return (
      <div className="pb-2">
        <div className="flex items-center gap-2 py-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <CheckCircle2 className="size-3.5 text-emerald-500" />
          <span className="text-[13px] font-sans" style={{ color: "#999999" }}>
            Plan completed
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-2">
      {/* Shimmer Planning... */}
      {isStreaming && events.length === 0 && (
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
          <span
            className="text-[15px] font-sans animate-shimmer"
            style={{
              background: "linear-gradient(90deg, #B3B3B3 25%, #FFFFFF 50%, #B3B3B3 75%)",
              backgroundSize: "200% 100%",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Planning...
          </span>
        </div>
      )}

      {/* Collapsible timeline */}
      {events.length > 0 && (
        <Collapsible
          open={isOpen}
          onOpenChange={setIsOpen}
          className="space-y-0"
        >
          <CollapsibleTrigger
            className="flex items-center gap-2 text-[15px] font-sans cursor-pointer select-none group py-1"
            style={{ color: "#CCCCCC" }}
          >
            <span className="font-medium">Planning...</span>
            <span className="text-[13px]" style={{ color: "#AAAAAA" }}>
              ({events.length})
            </span>
            {!allComplete && (
              <div
                className="size-1.5 rounded-full animate-pulse shrink-0"
                style={{ background: "rgba(16,185,129,0.6)" }}
              />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="relative">
              <div
                className="absolute left-[6px] top-2 bottom-2 w-px"
                style={{ background: "rgba(255,255,255,0.08)" }}
              />
              <div className="space-y-0">
                {events.map((event, idx) => (
                  <ActivityRow key={event.id} activity={event} index={idx} />
                ))}
              </div>
            </div>
            <div ref={bottomRef} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
