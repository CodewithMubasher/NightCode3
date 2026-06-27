import { NightCodeEngine } from "@/lib/engine"
import type { ToolImplementation } from "@/lib/engine/tools"
import type { AIProvider, Message } from "@/types"
import { createMCPToolImplementations } from "@/lib/mcp/tools-adapter"
import { EventRecorder } from "@/lib/db/event-recorder"
import { ToolIsolationService } from "@/lib/engine/tool-isolation-service"
import { CompactionService } from "@/lib/engine/compaction-service"
import { initSchema } from "@/lib/db/schema"
import { createSession } from "@/lib/db/adapter"
import { enableBatching, disableBatching, flushBatch } from "@/lib/db/batch"
import { loadMCPConfigs } from "@/lib/mcp/storage"
import { ensureConnected } from "@/lib/mcp/manager"

// Lazy singleton: MCP connections and tool definitions are initialized once
// and stay warm across requests instead of spawning subprocesses per request.
let mcpToolsPromise: Promise<ToolImplementation[]> | null = null

const SSE_API_KEY = process.env.SSE_API_KEY

function requireAuth(req: Request): Response | null {
  if (!SSE_API_KEY) return null
  const auth = req.headers.get("authorization")
  if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== SSE_API_KEY) {
    return new Response("Unauthorized", { status: 401 })
  }
  return null
}

function getMCPTools(): Promise<ToolImplementation[]> {
  if (!mcpToolsPromise) {
    mcpToolsPromise = (async () => {
      const configs = loadMCPConfigs()
      for (const config of configs) {
        if (config.enabled) {
          await ensureConnected(config)
        }
      }
      return createMCPToolImplementations()
    })()
  }
  return mcpToolsPromise
}

export async function POST(req: Request) {
  const authError = requireAuth(req)
  if (authError) return authError

  enableBatching()
  try {
    const body = await req.json()
    const { messages, messageId, chatId, model, provider: rawProvider, skillInjected, mode } = body

    console.log("API route received messages:", messages?.length ?? 0, "messages")
    messages?.forEach((m: any, i: number) => console.log(`  msg[${i}] role=${m.role} (${m.content?.length ?? 0} chars)`))
    console.log("API route skillInjected length:", skillInjected?.length ?? 0)

    if (!messages || !messageId) {
      return new Response("Missing required fields", { status: 400 })
    }

    const provider = (rawProvider || "opencode") as AIProvider
    const effectiveModel = model || "big-pickle"
    console.log(`[api/chat] rawProvider="${rawProvider}" resolved="${provider}" model="${effectiveModel}"`)

    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const engine = new NightCodeEngine()

    // Create DB session upfront — shared by EventRecorder and ToolIsolationService
    initSchema()
    const sessionId = messageId
    createSession({
      id: sessionId,
      chat_id: chatId ?? "unknown",
      status: "active",
      model: effectiveModel,
      provider,
      created_at: Date.now(),
      updated_at: Date.now(),
      metadata: JSON.stringify({ messageId }),
    })

    // Dual runtime: event recorder mirrors all engine events to SQLite
    const eventRecorder = new EventRecorder(
      chatId ?? "unknown",
      messageId,
      provider,
      effectiveModel,
      sessionId,
      true // skipToolTracking — ToolIsolationService handles it
    )

    // Phase 4: Tool execution isolation — stores results to DB, returns summaries to LLM
    const toolIsolation = new ToolIsolationService({ sessionId, enabled: true })

    // Phase 6: Auto-compaction every 10 steps — summarizes progress to prevent context bloat
    const compactionService = new CompactionService(sessionId, { compactionInterval: 10 })

    req.signal.addEventListener("abort", () => {
      abortController.abort()
    })

    const MAX_QUEUE = 1024
    let lastTextDelta: string | null = null
    let lastTextPayload: Record<string, unknown> | null = null

    const transform = new TransformStream<{ type: string; payload?: Record<string, unknown>; timestamp?: number }, Uint8Array>({
      start() {},
      transform(data, ctrl) {
        if (abortController.signal.aborted) return

        // Merge consecutive text_delta events
        if (data.type === "text_delta" && lastTextDelta !== null) {
          lastTextPayload = { text: String(lastTextPayload?.text ?? "") + String(data.payload?.text ?? "") }
          return
        }
        if (lastTextDelta !== null) {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text_delta", payload: lastTextPayload, timestamp: Date.now() })}\n\n`))
          lastTextDelta = null
          lastTextPayload = null
        }

        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ ...data, timestamp: data.timestamp ?? Date.now() })}\n\n`))
      },
      flush(ctrl) {
        if (lastTextDelta !== null) {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text_delta", payload: lastTextPayload, timestamp: Date.now() })}\n\n`))
        }
      },
    })

    const writable = transform.writable.getWriter()

    const unsubSSE = engine.subscribe((_event, data: any) => {
      if (abortController.signal.aborted) return

      const FORWARDED_EVENTS = new Set([
        "text_delta", "reasoning_delta", "tool_start", "tool_end",
        "artifact", "error", "message_complete", "ask",
        "confirmation", "usage", "thinking", "status", "permission",
      ])

      if (!FORWARDED_EVENTS.has(data.type)) {
        console.warn(`[SSE] Unhandled event type dropped: ${data.type}`)
        return
      }

      writable.write(data).catch(() => {})
    })

    // Mirror all events to SQLite (dual runtime — no engine changes)
    const unsubRecorder = engine.subscribe((_event, data: any) => {
      eventRecorder.record(data.type, data.payload ?? {})
    })

    let mcpTools: ToolImplementation[] = []
    try {
      mcpTools = await getMCPTools()
    } catch (e) { console.error("[chat] Failed to load MCP tools:", e) }
    console.log(`Loaded ${mcpTools.length} MCP tools`)

    const engineRun = engine.run(
      messages as Message[],
      messageId,
      provider,
      effectiveModel,
      abortController.signal,
      body.skillInjected,
      mcpTools,
      toolIsolation,
      compactionService,
      { mode: mode === "caat" ? "caat" : "standard" }
    )

    const stream = new ReadableStream({
      async start(controller) {
        const reader = transform.readable.getReader()

        async function pump() {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              controller.enqueue(value)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Stream error"
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", payload: { message: msg }, timestamp: Date.now() })}\n\n`))
            } catch {}
          }
        }

        const pumpPromise = pump()

        try {
          await engineRun
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Engine error"
          try {
            writable.write({ type: "error", payload: { message: msg }, timestamp: Date.now() })
          } catch {}
        } finally {
          unsubSSE()
          unsubRecorder()
          flushBatch()
          disableBatching()
          try {
            await writable.close()
          } catch {}
          await pumpPromise
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  } catch (err) {
    flushBatch()
    disableBatching()
    const msg = err instanceof Error ? err.message : "Invalid request"
    return new Response(
      `data: ${JSON.stringify({ type: "error", payload: { message: msg }, timestamp: Date.now() })}\n\ndata: [DONE]\n\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      }
    )
  }
}
