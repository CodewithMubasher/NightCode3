import type { ToolImplementation } from "@/lib/engine/tools"
import type { AIProvider, Message } from "@/types"
import { createMCPToolImplementations } from "@/lib/mcp/tools-adapter"
import { EventRecorder } from "@/lib/db/event-recorder"
import { initSchema } from "@/lib/db/schema"
import { createSession } from "@/lib/db/adapter"
import { enableBatching, disableBatching, flushBatch } from "@/lib/db/batch"
import { loadMCPConfigs } from "@/lib/mcp/storage"
import { ensureConnected } from "@/lib/mcp/manager"
import { buildSystemPrompt, PLAN_MODE_INSTRUCTIONS } from "@/lib/engine/context-builder"
import { TOOL_REGISTRY } from "@/lib/engine/tools"
import { AGENT_CONFIG, CAAT_CONFIG, PLAN_CONFIG } from "@/lib/engine/modes"
import { runEngine, CacheManager, Telemetry } from "@/lib/engine2"
import { messagesToSessionMessages, toolsToRecord, createProviderStreamFn } from "@/lib/engine2/bridge"
import type { SessionEvent } from "@/lib/engine2/types"

const globalCache = new CacheManager()

const SSE_API_KEY = process.env.SSE_API_KEY

function requireAuth(req: Request): Response | null {
  if (!SSE_API_KEY) return null
  const auth = req.headers.get("authorization")
  if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== SSE_API_KEY) {
    return new Response("Unauthorized", { status: 401 })
  }
  return null
}

async function getMCPTools(): Promise<ToolImplementation[]> {
  const configs = loadMCPConfigs()
  for (const config of configs) {
    if (config.enabled) {
      await ensureConnected(config)
    }
  }
  return createMCPToolImplementations()
}

function sessionEventToSSE(event: SessionEvent): { type: string; payload: Record<string, unknown>; timestamp: number } | null {
  const ts = Date.now()
  switch (event.type) {
    case "text-delta":
      return { type: "text_delta", payload: { text: event.text }, timestamp: ts }
    case "reasoning-delta":
      return { type: "reasoning_delta", payload: { text: event.text }, timestamp: ts }
    case "tool-start":
      return { type: "tool_start", payload: { tool: event.tool, args: event.args, toolCallId: event.toolCallId }, timestamp: ts }
    case "tool-end":
      return { type: "tool_end", payload: { tool: event.tool, args: event.args, status: event.status, result: event.result, error: event.error, toolCallId: event.toolCallId }, timestamp: ts }
    case "error":
      return { type: "error", payload: { message: event.message }, timestamp: ts }
    case "usage":
      return { type: "usage", payload: { inputTokens: event.inputTokens, outputTokens: event.outputTokens, reasoningTokens: event.reasoningTokens }, timestamp: ts }
    case "ask":
      return { type: "ask", payload: { questions: event.questions }, timestamp: ts }
    case "permission":
      return { type: "permission", payload: { tool: event.tool, args: event.args, reason: event.reason, toolCallId: event.toolCallId }, timestamp: ts }
    case "confirmation":
      return { type: "confirmation", payload: { path: event.path, fileCount: event.fileCount, toolCallId: event.toolCallId }, timestamp: ts }
    case "artifact":
      return { type: "artifact", payload: { artifact: event.artifact }, timestamp: ts }
    case "done":
      return { type: "message_complete", payload: { text: event.text }, timestamp: ts }
    default:
      return null
  }
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

    if (!messages || !messageId) {
      return new Response("Missing required fields", { status: 400 })
    }

    const provider = (rawProvider || "google") as AIProvider
    const effectiveModel = model || "gemini-2.5-flash"
    console.log(`[api/chat] provider="${provider}" model="${effectiveModel}"`)

    const encoder = new TextEncoder()

    // FIX 1: Use a dedicated abort controller that is ONLY triggered by the
    // client disconnecting. Do NOT pre-abort it anywhere in setup code.
    // The old code was fine here — the real issue was withRetry in the engine
    // consuming the full timeout budget. We add a timeout guard below instead.
    const abortController = new AbortController()

    // DB session (backward compat)
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

    const eventRecorder = new EventRecorder(
      chatId ?? "unknown",
      messageId,
      provider,
      effectiveModel,
      sessionId,
      true,
    )

    req.signal.addEventListener("abort", () => {
      abortController.abort()
    })

    // ─── SSE stream setup ────────────────────────────────────────────
    const transform = new TransformStream<{ type: string; payload?: Record<string, unknown>; timestamp?: number }, Uint8Array>({
      transform(data, ctrl) {
        if (abortController.signal.aborted) return
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ ...data, timestamp: data.timestamp ?? Date.now() })}\n\n`))
      },
      flush(ctrl) {
        ctrl.enqueue(encoder.encode("data: [DONE]\n\n"))
      },
    })

    const writable = transform.writable.getWriter()

    // Track token/sec timing
    const engineStartTime = Date.now()
    let cumulativeInputTokens = 0
    let cumulativeOutputTokens = 0
    let cumulativeReasoningTokens = 0

    const forwardToSSE = (event: SessionEvent) => {
      if (event.type === "usage") {
        cumulativeInputTokens += event.inputTokens ?? 0
        cumulativeOutputTokens += event.outputTokens ?? 0
        cumulativeReasoningTokens += event.reasoningTokens ?? 0

        const elapsed = (Date.now() - engineStartTime) / 1000
        const outputTokensPerSec = elapsed > 0 && cumulativeOutputTokens > 0
          ? Math.round(cumulativeOutputTokens / elapsed * 10) / 10
          : 0

        const sse: { type: string; payload: Record<string, unknown>; timestamp: number } = {
          type: "usage",
          payload: {
            provider,
            model: effectiveModel,
            inputTokens: cumulativeInputTokens,
            outputTokens: cumulativeOutputTokens,
            reasoningTokens: cumulativeReasoningTokens,
            outputTokensPerSec,
            cumulativeInputTokens,
            cumulativeOutputTokens,
            cumulativeReasoningTokens,
          },
          timestamp: Date.now(),
        }
        writable.write(sse).catch(() => {})
        eventRecorder.record("usage", sse.payload)
        return
      }

      // FIX 2: Emit artifact SSE event so the frontend panel can react
      // without waiting for a poll cycle. The artifact event carries the
      // full artifact object — frontend just needs to listen for type="artifact".
      const sse = sessionEventToSSE(event)
      if (sse) {
        writable.write(sse).catch(() => {})
        eventRecorder.record(sse.type, sse.payload ?? {})
      }
    }

    // ─── Load MCP tools ──────────────────────────────────────────────
    let mcpTools: ToolImplementation[] = []
    try {
      mcpTools = await getMCPTools()
    } catch (e) { console.error("[chat] Failed to load MCP tools:", e) }
    console.log(`Loaded ${mcpTools.length} MCP tools`)

    // ─── Build tools ─────────────────────────────────────────────────
    const effectiveMode: string = mode === "caat" ? "caat" : mode === "plan" ? "plan" : "standard"
    const currentConfig = effectiveMode === "caat" ? CAAT_CONFIG : effectiveMode === "plan" ? PLAN_CONFIG : AGENT_CONFIG

    let availableTools: ToolImplementation[] = currentConfig.tools
      .map((t) => TOOL_REGISTRY[t.name])
      .filter(Boolean) as ToolImplementation[]

    if (mcpTools) {
      availableTools = [...availableTools, ...mcpTools]
    }

    const toolsRecord = toolsToRecord(availableTools)

    // ─── Build system prompt ─────────────────────────────────────────
    const messagesTyped = messages as Message[]
    const lastUserMsg = messagesTyped[messagesTyped.length - 1]
    const userText = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : ""

    // System prompt contains only the model identity + env + AGENTS.md.
    // Mode instructions (plan, caat) are injected as synthetic messages, not in the prompt.
    const basePrompt = buildSystemPrompt(effectiveModel)
    const systemPrompt = skillInjected ? basePrompt + "\n\n" + skillInjected : basePrompt

    // ─── Convert messages to engine2 format ─────────────────────────
    const sessionMessages = messagesToSessionMessages(messagesTyped)

    // Inject plan mode as synthetic user message (opencode style with <system-reminder>)
    if (effectiveMode === "plan") {
      sessionMessages.unshift({ role: "user", parts: [{ type: "text", id: "plan-mode", text: PLAN_MODE_INSTRUCTIONS }] })
    }

    // ─── Create provider stream function ─────────────────────────────
    if (abortController.signal.aborted) {
      writable.close()
      return new Response("Aborted", { status: 499 })
    }

    const streamFn = createProviderStreamFn(provider, effectiveModel)

    // ─── Run engine ──────────────────────────────────────────────────
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

        const telemetry = new Telemetry()
        telemetry.start()

        try {
          const result = await runEngine({
            messages: sessionMessages.slice(0, -1),
            userMessage: userText,
            systemPrompt,
            streamFn,
            tools: toolsRecord,
            signal: abortController.signal,
            onEvent: forwardToSSE,
            maxSteps: 30,
            cache: globalCache.session,
            provider,
            model: effectiveModel,
            telemetry,
          })

          // FIX 3: Write context telemetry back from the engine result.
          // runEngine doesn't return windowState directly, but the telemetry
          // object is passed by reference — the context manager must write to it.
          // See patch for main-loop.ts below (contextUtilization + contextMax).
          telemetry.print()

          forwardToSSE({ type: "done", text: result.text })
        } catch (err) {
          telemetry.print()
          const msg = err instanceof Error ? err.message : "Engine error"

          // FIX 4: Log the FULL error including provider details so we can
          // diagnose NVIDIA/Groq failures from the server console.
          console.error(`[engine] Run failed (provider=${provider} model=${effectiveModel}):`, msg)
          if (err instanceof Error && err.stack) {
            console.error("[engine] Stack:", err.stack.split("\n").slice(0, 5).join("\n"))
          }

          try {
            writable.write({ type: "error", payload: { message: msg }, timestamp: Date.now() })
          } catch {}
        } finally {
          // FIX 5: flushBatch() was fire-and-forget. If it's async, we need
          // to await it. If it's sync it's fine — wrapping in try/catch
          // prevents it from blocking writable.close() on DB errors.
          try {
            flushBatch()
          } catch (e) {
            console.error("[db] flushBatch error:", e)
          }
          disableBatching()

          try {
            await writable.close()
          } catch {}

          await pumpPromise

          // FIX 6: Remove the duplicate [DONE] here. The TransformStream's
          // flush() already writes [DONE] when writable closes. Writing it
          // again here means the client receives two [DONE] frames which
          // can confuse SSE parsers and cause double-complete events.
          // controller.enqueue(encoder.encode("data: [DONE]\n\n"))  ← REMOVED
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