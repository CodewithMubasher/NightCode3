# Plan Mode — Full Code Analysis & Bug Catalog

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Full Code Listing](#2-full-code-listing)
3. [Data Flow](#3-data-flow)
4. [Bug Catalog](#4-bug-catalog)
5. [Bad Design Decisions](#5-bad-design-decisions)
6. [Why the Timeline Vanishes](#6-why-the-timeline-vanishes)
7. [Roadmap & Fixes](#7-roadmap--fixes)

---

## 1. Architecture Overview

The plan mode consists of **8 files** that work together:

```
User Input
    │
    ▼
route.ts ──► plan.ts (LangGraph) ──emit events──► chat-store.ts ──► timeline-store.ts
    │                                                        │──► artifact-store.ts
    │                                                        │──► message-bubble.tsx
    │                                                        │
    ▼                                                        ▼
SSE Stream                                              agent-timeline.tsx (Collapsible UI)
    │                                                        │
    ▼                                                        ▼
chat-store.ts (client side)                            artifact-panel.tsx (Side panel)
```

### File Map

| File | Role | Persisted? |
|---|---|---|
| `lib/ai/graphs/plan.ts` | LangGraph — 4 node pipeline: analyze → identify → generate → finalize | No (server) |
| `lib/ai/graphs/plan-helpers.ts` | Helpers: `detectArtifactType`, `shouldGenerateArtifact`, `generateId` | No (server) |
| `lib/ai/graphs/index.ts` | Dispatch — `"plan" → createPlanGraph()` | No (server) |
| `app/api/chat/route.ts` | SSE endpoint — invokes graph, parses JSON chunks, forwards events | No (server) |
| `store/timeline-store.ts` | Zustand store — in-memory event list | **NO** |
| `store/artifact-store.ts` | Zustand store — artifact list | **YES** (`persist`) |
| `store/chat-store.ts` | Zustand store — chats, messages, SSE handler | **YES** (`persist`) |
| `components/chat/agent-timeline.tsx` | UI — collapsible timeline with activity rows | React state only |
| `components/chat/message-bubble.tsx` | UI — renders AgentTimeline inline for plan mode | — |
| `components/artifact-panel.tsx` | UI — right panel with artifact list/reader | — |
| `components/top-header.tsx` | UI — FileText button toggles artifact panel | — |
| `app/(dashboard)/chat/[id]/page.tsx` | Page — renders MessageBubble for each message | — |

### Event Types (SSE)

| Event | Where emitted | Where consumed | Payload |
|---|---|---|---|
| `thinking_step` | route.ts (catch-all) | chat-store → appends text | `{ text: string }` |
| `clear` | route.ts (first real chunk) | chat-store → clears message content | `{}` |
| `timeline_activity` | plan.ts (graph) | chat-store → timeline-store | `{ id, type, title, status, fileReference, artifactId, timestamp }` |
| `artifact_create` | plan.ts (graph) | chat-store → artifact-store | `{ id, title, type, content }` |
| `final` | plan.ts (`finalize` node) | chat-store → sets message content, sets `isDone` | `{ text: string }` |
| `error` | route.ts (catch) | chat-store → shows error | `{ message: string }` |

---

## 2. Full Code Listing

### 2A. `lib/ai/graphs/plan-helpers.ts`

```typescript
export function detectArtifactType(
  filename: string
): "markdown" | "code" | "json" {
  if (filename.endsWith(".json")) return "json"
  if (
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    filename.endsWith(".js") ||
    filename.endsWith(".py") ||
    filename.endsWith(".css") ||
    filename.endsWith(".html") ||
    filename.endsWith(".sql") ||
    filename.endsWith(".yaml") ||
    filename.endsWith(".yml")
  )
    return "code"
  return "markdown"
}

export function shouldGenerateArtifact(
  _userRequest: string,    // ← UNUSED
  _artifactName: string     // ← UNUSED
): boolean {
  return true                // ← always returns true — dead code
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
```

### 2B. `lib/ai/graphs/plan.ts`

```typescript
import { Annotation, StateGraph, START, END } from "@langchain/langgraph"
import { executeLLM } from "../execute-llm"
import type { AIProvider } from "@/types"
import type { TimelineActivityType } from "@/store/timeline-store"
import { detectArtifactType, generateId } from "./plan-helpers"

const MessagesAnnotation = Annotation<
  Array<{ role: string; content: string }>
>({
  value: (current, incoming) => incoming ?? current,
  default: () => [],
})

const SystemPromptAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "",
})

const ModelAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "deepseek-v4-flash-free",
})

const ProviderAnnotation = Annotation<AIProvider>({
  value: (current, incoming) => incoming ?? current,
})

const AnalysisAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "",
})

const DeliverablesAnnotation = Annotation<string[]>({
  value: (current, incoming) => incoming ?? current,
  default: () => [],
})

export type GeneratedArtifact = {
  id: string
  title: string
  type: "markdown" | "code" | "json"
  content: string
}

const ArtifactsAnnotation = Annotation<GeneratedArtifact[]>({
  value: (current, incoming) => incoming ?? current,
  default: () => [],
})

const ResponseAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "",
})

export const PlanState = Annotation.Root({
  messages: MessagesAnnotation,
  systemPrompt: SystemPromptAnnotation,
  model: ModelAnnotation,
  provider: ProviderAnnotation,
  analysis: AnalysisAnnotation,
  deliverables: DeliverablesAnnotation,
  artifacts: ArtifactsAnnotation,
  response: ResponseAnnotation,
})

function getOnChunk(config: unknown): (chunk: string) => void {
  return (config as Record<string, Record<string, unknown>>)
    ?.configurable?.onChunk as (chunk: string) => void
}

function emit(
  onChunk: (chunk: string) => void,
  type: string,
  data: Record<string, unknown>
) {
  onChunk(JSON.stringify({ type, data }))
}

function emitActivity(
  onChunk: (chunk: string) => void,
  title: string,
  status: "pending" | "in_progress" | "completed",
  activityType: TimelineActivityType,
  fileReference?: { name: string; type: string },
  artifactId?: string,
  eventId?: string
): string {
  const id = eventId || generateId()
  emit(onChunk, "timeline_activity", {
    id,
    type: activityType,
    title,
    status,
    fileReference,
    artifactId,
    timestamp: Date.now(),
  })
  return id
}

export function createPlanGraph() {
  const graph = new StateGraph(PlanState)

  const withNodes = graph
    .addNode("analyze_request",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)

        const llmText = await executeLLM({
          provider: state.provider,
          model: state.model,
          messages: [
            {
              role: "system",
              content:
                "Analyze the user's request and produce a concise 1-paragraph understanding of what they need. Focus on the core deliverable. Output ONLY the analysis text, no extra commentary.",
            },
            ...state.messages,
          ],
          systemPrompt: state.systemPrompt,
          onChunk: () => {},   // ← NO streaming feedback
        })

        emitActivity(onChunk, "Analyzing request...", "completed", "analysis")
        //                                              ↑ jumps straight to completed
        //                                                user never sees "in_progress"

        return { analysis: llmText.trim() }
      }
    )
    .addNode("identify_deliverables",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)

        const llmText = await executeLLM({
          provider: state.provider,
          model: state.model,
          messages: [
            {
              role: "system",
              content: `You are a planning assistant. ...`,
            },
            {
              role: "user",
              content: `Analysis of request: ${state.analysis}\n\nWhat artifacts should be created?`,
            },
          ],
          systemPrompt: state.systemPrompt,
          onChunk: () => {},   // ← NO streaming feedback
        })

        let deliverables: string[] = []
        try {
          const cleaned = llmText.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")
          deliverables = JSON.parse(cleaned)
          if (!Array.isArray(deliverables)) deliverables = ["Plan.md"]
        } catch {
          deliverables = ["Plan.md"]
        }

        if (deliverables.length === 0) deliverables = ["Plan.md"]

        emitActivity(onChunk, `Searching ${deliverables.length} deliverables...`, "completed", "search")
        //                                                                         ↑ jumps straight to completed

        return { deliverables }
      }
    )
    .addNode("generate_artifacts",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)
        const generated: GeneratedArtifact[] = []

        for (const name of state.deliverables) {
          const ext = name.split(".").pop() || ""
          const fileRef = { name, type: ext }
          const eventId = generateId()

          emitActivity(onChunk, `Generating ${name}`, "in_progress", "generate", fileRef, undefined, eventId)
          //                                                                                             ↑ shared ID
          let content: string

          try {
            const docType = detectArtifactType(name)

            const systemPrompt = `You are a technical writer. ...`

            const llmText = await executeLLM({
              provider: state.provider,
              model: state.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Request analysis: ${state.analysis}\n\nGenerate the complete content for: ${name}` },
              ],
              onChunk: () => {},   // ← NO streaming feedback
            })

            content = llmText.trim()
          } catch {
            content = `# ${name}\n\n*Content generation failed for this artifact.*`
          }

          const artifactId = generateId()
          const artifactType = detectArtifactType(name)

          generated.push({ id: artifactId, title: name, type: artifactType, content })

          emit(onChunk, "artifact_create", { id: artifactId, title: name, type: artifactType, content })

          emitActivity(onChunk, `Generated ${name}`, "completed", "generate", fileRef, artifactId, eventId)
          //                                                                                          ↑ same ID → upserts
        }

        return { artifacts: generated }
      }
    )
    .addNode("finalize",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)
        const count = state.artifacts.length
        const names = state.artifacts.map((a) => a.title).join(", ")

        emitActivity(onChunk, "Plan complete", "completed", "complete")
        //                                        ↑ jumps straight to completed, no in_progress phase

        const llmText = await executeLLM({
          provider: state.provider,
          model: state.model,
          messages: [
            {
              role: "system",
              content: `You are a concise technical assistant. ... The following artifacts were generated: ${names}`,
            },
            { role: "user", content: `Summarize the ${count} artifacts created for: ${state.analysis}` },
          ],
          systemPrompt: state.systemPrompt,
          onChunk: () => {},   // ← NO streaming feedback
        })

        const summary = llmText.trim()
        emit(onChunk, "final", { text: summary })

        return { response: summary }
      }
    )

  const compiled = withNodes
    .addEdge(START, "analyze_request")
    .addEdge("analyze_request", "identify_deliverables")
    .addEdge("identify_deliverables", "generate_artifacts")
    .addEdge("generate_artifacts", "finalize")
    .addEdge("finalize", END)
    .compile()

  return compiled
}
```

### 2C. `store/timeline-store.ts`

```typescript
import { create } from "zustand"

export type TimelineActivityType = "analysis" | "search" | "read" | "scan" | "generate" | "complete"

export type TimelineActivity = {
  id: string
  type: TimelineActivityType
  title: string
  status: "pending" | "in_progress" | "completed"
  fileReference?: { name: string; type: string }
  artifactId?: string
  timestamp: number
}

interface TimelineStore {
  events: TimelineActivity[]
  addEvent: (event: TimelineActivity) => string      // ← upserts by ID
  updateEventStatus: (id: string, status: TimelineActivity["status"]) => void
  clearEvents: () => void
}

let counter = 0

export const useTimelineStore = create<TimelineStore>((set, get) => ({
  events: [],

  addEvent: (event) => {
    const id = event.id || `tl_${Date.now()}_${counter++}`
    const existing = get().events.find((e) => e.id === id)
    if (existing) {
      // UPSERT — updates in-place instead of adding duplicate
      set((state) => ({
        events: state.events.map((e) =>
          e.id === id ? { ...e, ...event, id } : e
        ),
      }))
    } else {
      const newEvent: TimelineActivity = {
        ...event, id, timestamp: event.timestamp || Date.now(),
      }
      set((state) => ({ events: [...state.events, newEvent] }))
    }
    return id
  },

  updateEventStatus: (id, status) =>
    set((state) => ({
      events: state.events.map((e) => e.id === id ? { ...e, status } : e),
    })),

  clearEvents: () => set({ events: [] }),
}))
```

### 2D. `store/chat-store.ts` (relevant section — SSE handler)

```typescript
// Inside sendMessage(), when mode === "plan":
if (chat.mode === "plan") {
  useTimelineStore.getState().clearEvents()     // ← wipes previous timeline
}

// SSE parsing loop:
const event = JSON.parse(trimmed.slice(6))

if (event.type === "thinking_step") {
  // appends text to assistant message
} else if (event.type === "clear") {
  // clears assistant message content
} else if (event.type === "timeline_activity") {
  const ev = event.data as Record<string, unknown>
  if (ev?.title) {
    useTimelineStore.getState().addEvent({
      id: ev.id as string,
      type: (ev.type as ...) || "analysis",
      title: ev.title as string,
      status: (ev.status as ...) || "completed",
      fileReference: ...,
      artifactId: ...,
      timestamp: (ev.timestamp as number) || Date.now(),
    })
  }
} else if (event.type === "artifact_create") {
  // adds to artifact store
} else if (event.type === "final") {
  const text = (event.data?.text as string) || ""
  if (text) { /* set message content */ }
  isDone = true
}
```

### 2E. `components/chat/agent-timeline.tsx`

```typescript
"use client"
import { useEffect, useRef, useState } from "react"
import {
  Loader2, CheckCircle2, Circle, FileText, FileCode, FileJson, ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { TimelineActivity } from "@/store/timeline-store"
import { useTimelineStore } from "@/store/timeline-store"
import { useArtifactStore } from "@/store/artifact-store"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"

const fileIconMap: Record<string, typeof FileText> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
  css: FileCode, html: FileCode, py: FileCode, sql: FileCode,
  json: FileJson, yaml: FileCode, yml: FileCode, md: FileText,
}

function FilePill({ file }: { file: { name: string; type: string } }) {
  const Icon = fileIconMap[file.type] || FileText
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono"
      style={{ background: "#1A1A1A", border: "1px solid rgba(255,255,255,0.08)", color: "#B3B3B3" }}>
      <Icon className="size-3" />
      {file.name}
    </span>
  )
}

function ActivityRow({ activity, index }: { activity: TimelineActivity; index: number }) {
  const isActive = activity.status === "in_progress"
  const isCompleted = activity.status === "completed"
  const isPending = activity.status === "pending"
  const openPanel = useArtifactStore((s) => s.openPanel)
  const artifacts = useArtifactStore((s) => s.artifacts)

  return (
    <div className="group flex items-start gap-3 py-1.5 animate-in"
         style={{ animationDelay: `${index * 30}ms` }}>
      <div className="relative mt-[3px] shrink-0 size-[14px]">
        {isActive && (
          <div className="absolute inset-0 rounded-full animate-pulse"
               style={{ background: "rgba(16,185,129,0.2)" }} />
        )}
        <div className="relative flex size-full items-center justify-center">
          {isCompleted && <CheckCircle2 className="size-3.5 text-emerald-500" />}
          {isActive && <Loader2 className="size-3.5 text-emerald-500 animate-spin" />}
          {isPending && <Circle className="size-3.5" color="#B3B3B3" />}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
        <span className={cn("truncate text-sm font-mono",
          isActive && "text-white",
          isCompleted && "text-[#B3B3B3]",
          isPending && "text-[#6B6B6B]"
        )}>
          {activity.title}
        </span>

        {activity.fileReference && <FilePill file={activity.fileReference} />}

        {activity.artifactId && isCompleted && (
          <button onClick={() => {
              const artifact = artifacts.find((a) => a.id === activity.artifactId)
              if (artifact) openPanel(artifact)
            }}
            className="shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs
                       transition-colors hover:bg-white/5"
            style={{ background: "#1A1A1A", borderColor: "rgba(255,255,255,0.08)", color: "#B3B3B3" }}>
            <FileText className="size-3" />
            Open
          </button>
        )}
      </div>
    </div>
  )
}

export function AgentTimeline({ isStreaming }: { isStreaming?: boolean }) {
  const events = useTimelineStore((s) => s.events)
  const [isOpen, setIsOpen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const allComplete = events.every((e) => e.status === "completed")

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events.length])

  // ★★★ THE BUG: returns null when no events AND not streaming ★★★
  if (events.length === 0 && !isStreaming) return null

  return (
    <div className="pb-2">
      {/* Shimmer "Planning..." — only shows when streaming with zero events */}
      {isStreaming && events.length === 0 && (
        <div className="flex items-center gap-2 py-1 animate-in fade-in-0 duration-500">
          <div className="size-[14px] relative mt-[3px] shrink-0">
            <div className="absolute inset-0 rounded-full animate-pulse"
                 style={{ background: "rgba(16,185,129,0.2)" }} />
            <div className="relative flex size-full items-center justify-center">
              <Loader2 className="size-3.5 text-emerald-500 animate-spin" />
            </div>
          </div>
          <span className="text-sm font-mono animate-shimmer"
                style={{
                  background: "linear-gradient(90deg, #B3B3B3 25%, #FFFFFF 50%, #B3B3B3 75%)",
                  backgroundSize: "200% 100%",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}>
            Planning...
          </span>
        </div>
      )}

      {events.length > 0 && (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-0">
          <CollapsibleTrigger className="flex items-center gap-2 text-xs font-mono cursor-pointer select-none group py-1"
                              style={{ color: "#6B6B6B" }}>
            <ChevronRight className="size-3 transition-transform duration-200"
                          style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }} />
            <span>Activities</span>
            <span className="text-[10px]" style={{ color: "#4B4B4B" }}>{events.length}</span>
            {!allComplete && (
              <div className="size-1.5 rounded-full animate-pulse shrink-0"
                   style={{ background: "rgba(16,185,129,0.6)" }} />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="relative">
              <div className="absolute left-[6px] top-2 bottom-2 w-px"
                   style={{ background: "rgba(255,255,255,0.08)" }} />
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
```

### 2F. `components/chat/message-bubble.tsx`

```typescript
"use client"
import type { Message } from "@/types"
import { Copy, ThumbsUp, ThumbsDown, MoreHorizontal, Eclipse } from "lucide-react"
import { Attachments, Attachment, AttachmentPreview } from "@/components/ai-elements/attachments"
import { AgentTimeline } from "./agent-timeline"

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return ( /* user bubble */ )
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 items-center justify-center pt-1">
          <Eclipse size={20} style={{ color: "#0099ff" }}
                   className={message.isStreaming ? "animate-spin" : ""} />
        </div>
        <div className="min-w-0 flex-1 pt-1.5">
          {message.mode === "plan" ? (
            <>
              <AgentTimeline isStreaming={message.isStreaming} />
              {message.content && (
                <div className="mt-3 text-sm leading-relaxed whitespace-pre-wrap"
                     style={{ color: "#FFFFFF" }}>
                  {message.content}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </div>
          )}
          {!message.isStreaming && message.content && message.mode !== "plan" && (
            <div className="mt-2 flex items-center gap-0.5">
              {/* Copy / ThumbsUp / ThumbsDown / MoreHorizontal — HIDDEN in plan mode */}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

### 2G. `app/api/chat/route.ts`

```typescript
import { getGraph } from "@/lib/ai/graphs"
import { getDefaultModel } from "@/lib/ai/execute-llm"

function sse(event: string, data: unknown): string {
  return `data: ${JSON.stringify({ type: event, data })}\n\n`
}

export async function POST(req: Request) {
  try {
    const { messages, model: modelId, mode = "chat", provider: rawProvider } = await req.json()
    if (!rawProvider) throw new Error("Provider is missing — routing broken")
    const provider = rawProvider as string

    const graph = getGraph(mode)
    const encoder = new TextEncoder()
    const effectiveModel = modelId || getDefaultModel(provider)

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sse("thinking_step", { text: "Thinking..." })))
        controller.enqueue(encoder.encode(sse("debug", { provider, model: effectiveModel })))

        let firstRealChunk = true
        let planFinalSent = false

        try {
          await graph.invoke(
            {
              messages,
              model: effectiveModel,
              provider: provider as AIProvider,
              systemPrompt: "You are NightCode, a friendly and helpful AI assistant. Be concise, warm, and direct. Keep responses natural and conversational.",
              response: "",
            },
            {
              configurable: {
                onChunk: (chunk: string) => {
                  try {
                    const parsed = JSON.parse(chunk)
                    if (parsed?.type) {
                      if (parsed.type === "final") planFinalSent = true
                      if (firstRealChunk) {
                        firstRealChunk = false
                        controller.enqueue(encoder.encode(sse("clear", {})))
                      }
                      controller.enqueue(encoder.encode(sse(parsed.type, parsed.data)))
                      return
                    }
                  } catch {}
                  // ↑ JSON parse fails → treat as raw text (chat mode)
                  if (firstRealChunk) {
                    firstRealChunk = false
                    controller.enqueue(encoder.encode(sse("clear", {})))
                  }
                  controller.enqueue(encoder.encode(sse("thinking_step", { text: chunk })))
                },
              },
            }
          )

          if (!planFinalSent) {
            controller.enqueue(encoder.encode(sse("final", { text: "" })))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Stream error"
          controller.enqueue(encoder.encode(sse("error", { message: `[${provider}] ${msg}` })))
        } finally {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid request"
    return new Response(sse("error", { message: msg }) + "data: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
    })
  }
}
```

---

## 3. Data Flow

### 3A. Fresh Plan Run

```
1. User sends "Create a PRD"
2. chat-store.sendMessage:
   a. clearEvents() — wipes timeline
   b. Creates user + assistant messages
   c. POSTs to /api/chat with mode="plan"
3. route.ts:
   a. Creates SSE stream
   b. Sends "Thinking..." + "debug" events
   c. Calls graph.invoke()
4. Graph — analyze_request:
   a. executeLLM (user sees "Thinking..." text from earlier)
   b. Emits: timeline_activity { id: "tl_1", title: "Analyzing request...", status: "completed" }
5. Graph — identify_deliverables:
   a. executeLLM (silent — no streaming text)
   b. Emits: timeline_activity { id: "tl_2", title: "Searching 3 deliverables...", status: "completed" }
6. Graph — generate_artifacts (per file):
   a. Emits: timeline_activity { id: "tl_3", title: "Generating PRD.md", status: "in_progress" }
   b. executeLLM (silent)
   c. Emits: artifact_create { id: "art_1", title: "PRD.md", content: "..." }
   d. Emits: timeline_activity { id: "tl_3", title: "Generated PRD.md", status: "completed" }
   e. Repeats for each deliverable
7. Graph — finalize:
   a. Emits: timeline_activity { id: "tl_N", title: "Plan complete", status: "completed" }
   b. executeLLM (silent)
   c. Emits: final { text: "Created a comprehensive PRD..." }
8. route.ts sends data: [DONE]
9. chat-store:
   a. Each timeline_activity → timeline-store.addEvent (upsert)
   b. Each artifact_create → artifact-store.addArtifact
   c. final → sets message content, isDone = true
10. React re-renders:
    a. AgentTimeline shows events (collapsible, open)
    b. Final text shows below timeline
```

### 3B. Page Refresh with Existing Plan Message

```
1. chat-store loads persisted chats (has a plan mode message)
2. artifact-store loads persisted artifacts
3. timeline-store starts EMPTY (NOT persisted)
4. ChatPage renders MessageBubble for each message
5. For the plan mode assistant message:
   a. message.isStreaming === false
   b. message.mode === "plan"
   c. AgentTimeline is rendered with isStreaming={false}
   d. useTimelineStore.getState().events === []
   e. events.length === 0 && !isStreaming → TRUE
   f. AgentTimeline returns null → ★ TIMELINE VANISHES ★
6. Only the final AI text appears
```

---

## 4. Bug Catalog

### B1. ★ CRITICAL — Timeline Vanishes on Page Refresh

**File**: `components/chat/agent-timeline.tsx:136`
```typescript
if (events.length === 0 && !isStreaming) return null
```

**Root cause**: The timeline store is **in-memory only** (no `persist` middleware), while the chat store and artifact store both persist. On page refresh, the persisted chat shows `mode: "plan"` with `isStreaming: false`, but the timeline store is empty. The guard clause returns null. The timeline is permanently gone.

**Impact**: Every page refresh erases the timeline. Users see only the final AI summary text with no indication of what work was done. This makes the timeline feature feel broken.

**Fix**: Either (a) persist the timeline store, or (b) add a fallback in AgentTimeline to show a "Plan complete" summary when there are no events and streaming is done.

### B2. ★ HIGH — Spinner Never Stopped (FIXED)

**File**: `lib/ai/graphs/plan.ts:81-100` (before fix)

**Root cause (original)**: `emitActivity` generated a NEW `id` for every call. When a single activity first emitted `{id: "tl_a", status: "in_progress", title: "Generating X"}` and later `{id: "tl_b", status: "completed", title: "Generated X"}`, BOTH events were added as separate rows. The first row never got marked completed, so its spinner ran forever.

**Fix applied**: `emitActivity` now accepts a shared `eventId`. The in_progress and completed events use THE SAME ID. `addEvent` in the timeline store detects the existing ID and **upserts** (updates in-place instead of appending duplicate).

### B3. ★ HIGH — AI Ignores Quantity Requests (FIXED)

**File**: `lib/ai/graphs/plan.ts:148-160`

**Root cause**: The `identify_deliverables` system prompt had examples showing only 3+ items. No instruction to respect user-stated quantities. The LLM defaulted to 3 files regardless of what the user said.

**Fix applied**: Added explicit instruction: *"The user may specify how many items they want... You MUST respect their stated quantity."* Examples now include single-file and two-file cases.

### B4. ★ MEDIUM — Event Status Inconsistency

**Files**: `lib/ai/graphs/plan.ts:127-132, 182-187, 287-292`

| Event | Status emitted | Problem |
|---|---|---|
| "Analyzing request..." | `completed` | Jumps to done with NO `in_progress` phase → user never sees it "working" |
| "Searching N deliverables..." | `completed` | Same — no `in_progress` phase |
| "Generating X" | `in_progress` → `completed` | ✅ Correct pattern |
| "Plan complete" | `completed` | No `in_progress` phase |

**Impact**: Inconsistent UX. Analysis and search steps appear instantaneously (no spinner), while generate steps show spinners. The user gets an inconsistent mental model.

### B5. ★ MEDIUM — Gap Events (No Activity During LLM Calls)

**File**: `lib/ai/graphs/plan.ts:112-124`

All `executeLLM` calls pass `onChunk: () => {}` — NO streaming text is forwarded to the user. Combined with B4, there are **silent gaps** where:
- "Analyzing request..." appears as completed, then the LLM runs to identify deliverables (silent gap)
- "Searching N deliverables..." appears as completed, then the LLM generates each artifact (silent gap between events)

The user sees nothing during these gaps. Only timeline events popping in provide feedback.

### B6. ★ MEDIUM — The "Shimmer Planning..." Is Only Visible for a Split Second

**File**: `components/chat/agent-timeline.tsx:77-93`

```typescript
{isStreaming && events.length === 0 && ( /* shimmer */ )}
```

The shimmer disappears as soon as the first `timeline_activity` event arrives. If the first event ("Analyzing request...") arrives within 500ms (which it does since the graph emits it immediately after the initial LLM call), the shimmer is barely visible. The user may never see it.

### B7. ★ MEDIUM — No `error` Status in TimelineActivity

**File**: `store/timeline-store.ts:3-19`

`TimelineActivity.status` only allows `"pending" | "in_progress" | "completed"`. If an artifact generation fails, the catch block emits the activity as `completed` with a fallback content message. The UI shows a green checkmark even for failures. There's no way to indicate an error visually.

### B8. ★ LOW — Artifact Accumulation

**File**: `store/artifact-store.ts:57-93`

The artifact store uses `persist` but has NO cleanup mechanism. Each plan run adds new artifacts. Over time, the artifact list grows unboundedly. There's no "Clear all" button in the panel and no dedup (though IDs are unique).

### B9. ★ LOW — Dead Code: `shouldGenerateArtifact`

**File**: `lib/ai/graphs/plan-helpers.ts:20-25`

```typescript
export function shouldGenerateArtifact(
  _userRequest: string,     // ← unused
  _artifactName: string     // ← unused
): boolean {
  return true               // ← always true, never called
}
```

This function is never imported or called anywhere. It's dead code.

### B10. ★ LOW — `useArtifactStore` Imported Directly in Timeline

**File**: `components/chat/agent-timeline.tsx:15`

```typescript
import { useArtifactStore } from "@/store/artifact-store"
```

The `ActivityRow` component calls `useArtifactStore((s) => s.openPanel)` and `useArtifactStore((s) => s.artifacts)` directly. This creates a tight coupling. For a reusable component, these should be passed as callbacks/props. Currently it works but violates separation of concerns.

### B11. ★ COSMETIC — Collapsible Default State

**File**: `components/chat/agent-timeline.tsx:97`

```typescript
const [isOpen, setIsOpen] = useState(true)
```

The timeline starts open. When all events complete and streaming stops, the user must manually collapse it. There's no auto-collapse after completion. The pulsing green dot does indicate "still working", but completed state has no visual change in the collapse toggle.

### B12. ★ COSMETIC — Shimmer Uses Inline CSS, Not `<Shimmer>` Component

**File**: `components/chat/agent-timeline.tsx:86-93`

```typescript
<span className="text-sm font-mono animate-shimmer"
      style={{ background: "linear-gradient(...)", ... }}>
  Planning...
</span>
```

Uses manual CSS animation instead of the existing `<Shimmer>` component from `ai-elements/shimmer.tsx`. The ai-elements `Shimmer` component itself has lint errors (creates motion components during render), so this deviation is arguably intentional — but it's inconsistent with the codebase conventions.

### B13. ★ COSMETIC — `route.ts` Sends Empty `final` Fallback

**File**: `app/api/chat/route.ts:78-80`

```typescript
if (!planFinalSent) {
  controller.enqueue(encoder.encode(sse("final", { text: "" })))
}
```

If the `finalize` node doesn't emit a `final` event (e.g., crash), an empty `final` event is sent. The chat store handles this: `if (text) { /* set content */ }` — the empty text is skipped. But `isDone` is NOT set (the `"final"` handler sets `isDone = true`), so the loop continues until the stream closes. This is a minor edge case that's handled, but could be cleaner.

---

## 5. Bad Design Decisions

### D1. Timeline Store NOT Persisted (While Everything Else Is)

The chat store and artifact store use `zustand/middleware/persist`. The timeline store does not. This asymmetry is the root cause of B1 (timeline vanishing). The original reasoning ("timeline events are transient") conflicts with user expectations — once something is rendered, users expect it to stay.

**Recommendation**: Either persist the timeline store OR add a rendering fallback for completed plan messages.

### D2. Events Emitted Without `in_progress` Phase

Three out of five activity types jump straight to `completed`. Only `"generate"` uses the proper `in_progress → completed` transition. This means:
- "Analyzing request..." just pops in as done
- "Searching N deliverables..." just pops in as done
- "Plan complete" just pops in as done

Users see a series of checkmarks appearing, but no real-time work indication.

**Recommendation**: Emit EVERY activity with `in_progress` first, then `completed` when done. This gives consistent spinner behavior.

### D3. Zero User Feedback During LLM Execution (`onChunk: () => {}`)

Every `executeLLM` call in the graph passes `onChunk: () => {}`. This means the user sees NO streaming text during:
- Request analysis
- Deliverable identification
- Artifact generation (each file)
- Final summary generation

The only feedback is discrete timeline events popping in. For long-running generations (>10 seconds), the user sees nothing happening.

**Recommendation**: Pipe `onChunk` through for at least the final summary generation. For artifact generation, periodically emit progress updates.

### D4. Timeline Rendered Inside Message Bubble (Scoped Per Message)

```tsx
{message.mode === "plan" ? (
  <>
    <AgentTimeline isStreaming={message.isStreaming} />
    {message.content && ( /* final text */ )}
  </>
) : ( /* chat mode */ )}
```

The timeline is rendered **inside** a single message bubble. If the user sends multiple plan mode messages, each assistant message will render `AgentTimeline`, but they all read from the same `useTimelineStore`. When a new plan run starts, `clearEvents()` wipes ALL events, including those for previous plan messages. Previous messages' timelines become empty.

**Recommendation**: Either scope timeline events per message (store events in the message object itself) or clear the timeline only for the CURRENT streaming message.

### D5. `useEffect` with `sidebarOpen` Dependency Creates Loop

**File**: `components/artifact-panel.tsx:31-40`

```typescript
useEffect(() => {
  if (isOpen) {
    sidebarWasOpen.current = sidebarOpen
    setSidebarOpen(false)
  } else if (wasOpened.current) {
    setSidebarOpen(sidebarWasOpen.current)
  }
}, [isOpen, sidebarOpen, setSidebarOpen])
```

The effect depends on `sidebarOpen`, but also calls `setSidebarOpen`. This can create a re-render loop. The `sidebarWasOpen.current` ref mitigates this, but it's a fragile pattern.

### D6. Artifact Type Mismatch

`detectArtifactType()` returns `"markdown" | "code" | "json"`, but `ArtifactType` in `artifact-store.ts` is `"markdown" | "code" | "html" | "svg" | "mermaid"`. Casting happens in `chat-store.ts`:
```typescript
type: (art.type as "markdown" | "code" | "html" | "svg" | "mermaid") || "markdown",
```
Since the graph never emits `"html"`, `"svg"`, or `"mermaid"`, any artifact with these types would be cast to `"markdown"`. This is a latent type mismatch.

### D7. No Way to Cancel a Running Plan

Once a plan starts, there's no cancel button. The `isThinking` flag and `streamingMessageId` prevent new messages, but the user can't abort a long-running generation. The stream continues until the graph completes or errors.

---

## 6. Why the Timeline Vanishes

This is the most impactful bug, so it deserves its own section.

### The Exact Code Path

When a user refreshes the page after a plan mode response:

```
Page load
  │
  ▼
useChatStore loads persisted chats
  → chat.messages has assistant message with mode="plan", isStreaming=false
  │
  ▼
useArtifactStore loads persisted artifacts
  → artifacts contains generated files
  │
  ▼
useTimelineStore initializes with empty events []
  → NO persist → in-memory starts fresh
  │
  ▼
ChatPage renders <MessageBubble message={assistantMessage} />
  │
  ▼
MessageBubble sees message.mode === "plan"
  → renders <AgentTimeline isStreaming={false} />
  │
  ▼
AgentTimeline:
  → events = useTimelineStore(s => s.events)  // []
  → isStreaming = false
  → events.length === 0 && !isStreaming === TRUE
  → return null   ← TIMELINE VANISHES
```

### Why It Was Designed This Way

The `return null` guard was added to prevent an empty timeline section from appearing before any events arrive during a fresh plan run. Without it, the user would see a `<div className="pb-2">` with nothing inside, wasting vertical space.

However, this same guard fires for **completed** plan messages after page refresh. The guard doesn't distinguish between "never had events" (fresh run) and "had events but they're gone" (page refresh).

### How to Fix

**Option A — Persist the timeline store** (simple, but accumulates stale events)

Add `persist` middleware to `timeline-store.ts`:
```typescript
export const useTimelineStore = create<TimelineStore>()(
  persist(
    (set, get) => ({ /* ... */ }),
    { name: "nightcode-timeline" }
  )
)
```

**Option B — Fallback rendering for completed state** (UX-focused)

In `AgentTimeline`, when `events.length === 0 && !isStreaming`:
```typescript
if (events.length === 0 && !isStreaming) {
  return (
    <div className="pb-2">
      <div className="flex items-center gap-2 py-1" style={{ color: "#6B6B6B" }}>
        <CheckCircle2 className="size-3.5 text-emerald-500" />
        <span className="text-xs font-mono">Plan completed</span>
      </div>
    </div>
  )
}
```

**Best fix**: Combine both — persist the timeline store **and** add a fallback render when persisted events are somehow missing.

---

## 7. Roadmap & Fixes

### Immediate (Critical)

| # | Issue | Effort |
|---|---|---|
| B1 | Timeline vanishes on refresh | 1hr |
| B4 | Event status inconsistency (add `in_progress` for all events) | 1hr |
| B5 | Show streaming text during LLM calls | 2hr |

### Short-term (High Priority)

| # | Issue | Effort |
|---|---|---|
| B6 | Shimmer barely visible — show until first event or add delay | 30min |
| B7 | Add `error` status to TimelineActivity | 30min |
| D4 | Scope timeline per message instead of global store | 3hr |
| D6 | Fix artifact type mismatch | 30min |

### Medium-term

| # | Issue | Effort |
|---|---|---|
| B8 | Add artifact cleanup (clear old, dedup, limit count) | 1hr |
| D3 | Pipe `onChunk` for artifact generation streaming | 4hr |
| D7 | Add cancel button for running plan | 2hr |
| D1 | Persist timeline store | 1hr |

### Nice-to-have

| # | Issue | Effort |
|---|---|---|
| B9 | Remove `shouldGenerateArtifact` dead code | 5min |
| B10 | Decouple timeline from artifact store (props) | 1hr |
| B11 | Auto-collapse timeline after completion | 30min |
| B12 | Use `<Shimmer>` component or remove the inconsistent one | 30min |
| D5 | Simplify sidebar effect in artifact-panel | 1hr |

### Type Changes Needed

**`store/timeline-store.ts`** — Add `error` status:
```typescript
export type TimelineActivityStatus = "pending" | "in_progress" | "completed" | "error"
```

**`store/artifact-store.ts`** — Align `ArtifactType` with what the graph emits:
```typescript
// Option A: Widen ArtifactType to match graph
export type ArtifactType = "markdown" | "code" | "json"

// Option B: Add mapping in chat-store
const artifactTypeMap: Record<string, ArtifactType> = {
  md: "markdown", ts: "code", json: "json", html: "html", svg: "svg",
}
```

### Persistence Architecture Decision

Current persistence map:
| Store | Persisted | Why |
|---|---|---|
| Chat store | ✅ | User expects messages to survive refresh |
| Artifact store | ✅ | Files are deliverables, should persist |
| Timeline store | ❌ | Considered transient — but this breaks UX |

**Recommendation**: Persist timeline store with a TTL or per-message scoping. Each timeline event references a `messageId`. When loading, only show events for the current message. This avoids accumulation while ensuring the timeline doesn't vanish.

---

*Analysis generated: 2026-06-13*
