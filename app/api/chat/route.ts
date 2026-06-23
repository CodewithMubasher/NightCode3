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

    const stream = new ReadableStream({
      async start(controller) {
        const criticalEvents = new Set(["tool_start", "tool_end", "artifact", "thinking", "error", "message_complete", "usage", "ask"])
        const unsubSSE = engine.subscribe((_event, data: any) => {
          if (abortController.signal.aborted) return
          console.log('SSE event:', data.type, data.payload ? JSON.stringify(data.payload).substring(0, 100) : '')
          const desiredSize = controller.desiredSize
          if (desiredSize !== null && desiredSize < 0) {
            if (data.type === "text_delta") {
              try {
                const line = `data: ${JSON.stringify(data)}\n\n`
                controller.enqueue(encoder.encode(line))
              } catch {}
            }
            if (criticalEvents.has(data.type)) {
              try {
                const line = `data: ${JSON.stringify(data)}\n\n`
                controller.enqueue(encoder.encode(line))
              } catch {}
            }
            return
          }
          try {
            const line = `data: ${JSON.stringify(data)}\n\n`
            controller.enqueue(encoder.encode(line))
          } catch {
            // stream closed
          }
        })

        // Mirror all events to SQLite (dual runtime — no engine changes)
        const unsubRecorder = engine.subscribe((_event, data: any) => {
          eventRecorder.record(data.type, data.payload ?? {})
        })

        let mcpTools: ToolImplementation[] = []
        try {
          mcpTools = await getMCPTools()
        } catch {}
        console.log(`Loaded ${mcpTools.length} MCP tools`)

        try {
          await engine.run(
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Engine error"
          const line = `data: ${JSON.stringify({
            type: "error",
            payload: { message: msg },
            timestamp: Date.now(),
          })}\n\n`
          try { controller.enqueue(encoder.encode(line)) } catch {}
        } finally {
          unsubSSE()
          unsubRecorder()
          flushBatch()
          disableBatching()
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
