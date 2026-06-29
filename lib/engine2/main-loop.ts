// ───────────────────────────────────────────────
// Port of opencode's session/prompt.ts main loop
// Event-driven LLM loop: stream → process → dispatch → repeat
// ───────────────────────────────────────────────

import {
  type SessionMessage,
  type ProviderMessage,
  type ToolDefinition,
  type ToolCallPart,
  type Tools,
  type ToolDef,
  type SessionEvent,
  type Usage,
} from "./types"

import { DoomLoopTracker } from "@/lib/engine/doom-loop-tracker"
import { compressToolSchemas as v1CompressToolSchemas } from "@/lib/engine/schema-compressor"
import { boundToolOutput } from "@/lib/engine/tool-output-store"
import type { Artifact } from "@/types"

import { Session, generateId } from "./session"
import { createAdapter } from "./adapter"
import type { ProviderStreamFn } from "./types"
import { dispatchTools, type DispatchResult } from "./tool-runtime"
import { ContextManager } from "./context/manager"
import type { ContextDecision } from "./context/decision-engine"
import type { SessionCache } from "./cache/session-cache"
import { Telemetry, type ToolTelemetry } from "./telemetry"

export interface EngineOptions {
  /** Conversation history (previous user ↔ assistant exchanges) */
  messages: SessionMessage[]
  /** The current user message (will be appended to messages) */
  userMessage: string
  /** System prompt */
  systemPrompt: string
  /** LLM provider streaming function */
  streamFn: ProviderStreamFn
  /** Registered tools */
  tools: Tools
  /** Abort signal */
  signal?: AbortSignal
  /** UI event callback */
  onEvent: (event: SessionEvent) => void
  /** Max iterations (default 30) */
  maxSteps?: number
  /** Provider name (for context manager) */
  provider?: string
  /** Model ID (for context manager) */
  model?: string
  /** Session-level cache (shared across steps) */
  cache?: SessionCache
  /** Telemetry collector */
  telemetry?: Telemetry
}

export interface EngineResult {
  text: string
  reasoning: string
  usage?: Usage
  steps: number
  session: Session
}

function parseFlatQuestions(input: string): Array<{
  id: string
  question: string
  type: string
  options: Array<{ label: string; value: string }>
}> {
  const blocks = input.split("\n\n").filter(Boolean)
  const questions: Array<{
    id: string
    question: string
    type: string
    options: Array<{ label: string; value: string }>
  }> = []
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) continue
    const qText = lines[0]
    const options: Array<{ label: string; value: string }> = []
    for (const line of lines.slice(1)) {
      const match = line.match(/^([A-Z])[.)]\s*(.+)/)
      if (match) {
        options.push({ label: match[2], value: match[1].toLowerCase() })
      } else {
        options.push({ label: line, value: line.toLowerCase().replace(/\s+/g, "-") })
      }
    }
    if (options.length > 0) {
      questions.push({
        id: `q${i + 1}`,
        question: qText,
        type: "select",
        options,
      })
    }
  }
  return questions
}

export async function runEngine(options: EngineOptions): Promise<EngineResult> {
  const {
    messages,
    userMessage,
    systemPrompt,
    streamFn,
    tools,
    signal,
    onEvent,
    maxSteps = 30,
    cache: sessionCache,
    provider,
    model,
    telemetry,
  } = options

  // Build the conversation for the LLM
  const conversation: SessionMessage[] = [
    ...messages,
    { role: "user", parts: [{ type: "text", id: generateId(), text: userMessage }] },
  ]

  let toolInstructions: string[] = []
  let stepCount = 0
  let consecutiveToolFailures = 0
  let lastStepHadToolCalls = false
  let session = new Session(generateId(), {
    onEvent,
    onStatusChange: () => {},
  })

  // Context manager for provider/model specific decisions
  const ctxManager = options.provider && options.model
    ? new ContextManager(options.provider, options.model)
    : undefined

  // Track accumulated results for each step
  let accumulatedText = ""
  let accumulatedReasoning = ""
  let finalUsage: Usage | undefined

  // Telemetry tracking
  let stepStartTime = Date.now()
  let totalApiTimeMs = 0

  if (telemetry) {
    telemetry.provider = options.provider ?? ""
    telemetry.model = options.model ?? ""
  }

  const doomTracker = new DoomLoopTracker()

  while (stepCount < maxSteps) {
    if (signal?.aborted) {
      session.dispose()
      return { text: accumulatedText, reasoning: accumulatedReasoning, usage: finalUsage, steps: stepCount, session }
    }

    stepCount++

    // Evaluate context before each LLM call
    if (ctxManager) {
      const providerMessages = Session.toProviderMessages(conversation)
      const toolDefs = toToolDefinitions(tools)
      const systemMsg = buildSystemMessage(systemPrompt, toolInstructions)

      const report = ctxManager.evaluate(
        systemMsg,
        providerMessages,
        toolDefs.map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema as Record<string, unknown> })),
        {
          stepCount,
          maxSteps,
          lastTextLength: accumulatedText.length,
          consecutiveToolFailures,
          isFirstStep: stepCount === 1,
          hasPendingToolCalls: lastStepHadToolCalls,
        },
      )

      console.log(`[ctx-manager] step=${stepCount} lastTextLen=${accumulatedText.length} hasTools=${lastStepHadToolCalls} decision=${report.decision.action}`)

      if (report.decision.action === "stop") {
        if (!accumulatedText) {
          accumulatedText = `The assistant stopped responding: ${report.decision.reason}`
        }
        break
      }

      if (report.decision.action === "compact") {
        compactConversation(conversation, report.windowState.providerMaxContext)
      }

      if (report.decision.action === "summarize") {
        const keep = Math.max(2, report.decision.keepLast)
        if (conversation.length > keep) {
          conversation.splice(0, conversation.length - keep)
        }
      }
    }

    // Create a new session for this step
    session.dispose()
    session = new Session(generateId(), {
      onEvent,
    })

    // Convert conversation to provider message format
    const providerMessages = Session.toProviderMessages(conversation)

    // Convert tools to definitions (with schema compression for providers with tight limits)
    const rawDefs = toToolDefinitions(tools)
    const toolDefs = provider
      ? v1CompressToolSchemas(
          rawDefs.map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema as Record<string, string> })),
          provider,
        ).map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema as Record<string, unknown> }))
      : rawDefs

    // Create adapter and stream
    const adapter = createAdapter(streamFn)

    // Add tool failure guidance
    const systemMsg = buildSystemMessage(systemPrompt, toolInstructions)

    // Suppress text-delta emission during streaming (emit manually after)
    session.suppressTextEmission = true

    try {
      await adapter.stream({
        messages: providerMessages,
        system: systemMsg,
        tools: toolDefs,
        signal,
        onEvent: (event) => {
          session.handleEvent(event)
        },
      })
    } catch (err) {
      if (telemetry) telemetry.stepCount = stepCount
      // Provider error or abort
      if (signal?.aborted) {
        session.suppressTextEmission = false
        return { text: accumulatedText, reasoning: accumulatedReasoning, usage: finalUsage, steps: stepCount, session }
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      onEvent({ type: "error", message: errorMsg })
      session.error = errorMsg
      session.suppressTextEmission = false
      session.dispose()
      return { text: accumulatedText || `Error: ${errorMsg}`, reasoning: accumulatedReasoning, usage: finalUsage, steps: stepCount, session }
    }

    // Get text and reasoning from this step
    const stepText = session.getText()
    const stepReasoning = session.getReasoning()

    // Track usage
    if (session.usage) {
      finalUsage = session.usage
    }

    // Check for pending tool calls
    const pendingCalls = session.getPendingToolCalls()

    console.log(`[loop] step=${stepCount} session parts: ${session.parts.map(p => `${p.type}`).join(', ')}`)
    console.log(`[loop] pendingCalls: ${pendingCalls.map(c => `[${c.toolCallId}]${c.name}(${JSON.stringify(c.input)})`).join(', ')}`)
    console.log(`[loop] finishReason=${session.finishReason} usage=${JSON.stringify(session.usage)}`)

    // Some providers return "stop" finish_reason even when the response contains
    // tool calls. Check both pending calls AND session parts for tool-call entries.
    // (Matches opencode's approach in session/prompt.ts line 1206-1233.)
    console.log(`[final-step] streaming completed: textLen=${stepText.length} pendingCalls=${pendingCalls.length} hasToolCallParts=${session.parts.some(p => p.type === "tool-call")}`)

    if (pendingCalls.length === 0) {
      const hasToolCallParts = session.parts.some(p => p.type === "tool-call")
      if (!hasToolCallParts) {
        // Final step — re-emit text to UI and accumulate
        session.suppressTextEmission = false
        if (stepText) {
          onEvent({ type: "text-delta", text: stepText })
          accumulatedText = (accumulatedText ? "\n\n" : "") + stepText
        }
        if (stepReasoning) {
          accumulatedReasoning += (accumulatedReasoning ? "\n" : "") + stepReasoning
        }
        break
      }
      console.log(`[safety-net] pendingCalls=0 but hasToolCallParts=true — falling through to dispatch`)
    }

    // Intermediate step — emit text as reasoning (model's internal monologue)
    session.suppressTextEmission = false
    if (stepText) {
      onEvent({ type: "reasoning-delta", text: stepText })
    }

    // Defer URL opens when shell runs in the same step (URL depends on shell output)
    const DEFER_CONFLICTS: Record<string, string[]> = {
      "open_url": ["shell"],
      "win_control_mcp_open_url": ["shell"],
    }
    const deferredIds = new Set<string>()
    const pendingNames = new Set(pendingCalls.map(c => c.name))
    for (const c of pendingCalls) {
      const blockers = DEFER_CONFLICTS[c.name]
      if (blockers && blockers.some(b => pendingNames.has(b))) {
        deferredIds.add(c.toolCallId)
      }
    }
    const activeCalls = pendingCalls.filter(c => !deferredIds.has(c.toolCallId))

    // Dispatch tools
    onEvent({ type: "text-delta", text: "" }) // flush

    // Check doom loops before dispatching — skip doomed calls
    const doomSkipped = new Set<number>()
    const safeCalls: ToolCallPart[] = []
    const doomResults: DispatchResult[] = []
    for (let i = 0; i < activeCalls.length; i++) {
      const call = activeCalls[i]
      const doomCheck = doomTracker.check(call.name, call.input as Record<string, unknown>)
      if (doomCheck.isDoomLoop) {
        console.warn(`[doom-loop] Tool "${call.name}" called with identical args ${doomCheck.matchedCount + 1}x`)
        doomSkipped.add(i)
        doomResults[i] = {
          result: { type: "error", value: `Doom loop: "${call.name}" called with identical args ${doomCheck.matchedCount + 1} times. Try a different approach.` },
          textOutput: "",
          cached: false,
          latencyMs: 0,
          events: [{ type: "tool-error", id: call.toolCallId, name: call.name, message: "Doom loop detected" }],
        }
      } else {
        safeCalls.push(call)
      }
    }

    const realResults = safeCalls.length > 0
      ? await dispatchTools(tools, safeCalls, sessionCache)
      : []

    // Merge results preserving original order (doom-skipped entries keep their slot)
    let safeIdx = 0
    const results: DispatchResult[] = activeCalls.map((_, i) =>
      doomSkipped.has(i) ? doomResults[i] : realResults[safeIdx++]
    )

    // Record tool telemetry
    if (telemetry) {
      for (const result of results) {
        telemetry.addToolCall(
          result.textOutput.slice(0, 40),
          result.latencyMs,
          result.cached,
          result.result.type !== "error",
        )
      }
    }

    // Add tool results to conversation (matching opencode's message format)
    const assistantParts = session.parts.filter(
      (p) => p.type === "text" || p.type === "reasoning" || (p.type === "tool-call" && !deferredIds.has(p.toolCallId))
    )
    if (assistantParts.length > 0) {
      conversation.push({ role: "assistant", parts: assistantParts })
    }
    console.log(`[loop] added assistant msg: ${assistantParts.length} parts (${assistantParts.map(p => p.type).join(',')})`)
    console.log(`[loop] conversation now has ${conversation.length} msgs`)

    // Track any errors for the next iteration
    toolInstructions = []
    let askedUser = false

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const call = activeCalls[i]

      // ── Special tool: ask ──────────────────────────────────
      if (call.name === "ask" && result.result.type !== "error") {
        let questions: unknown = []
        try {
          const data = typeof result.result.value === "object" && result.result.value !== null
            ? (result.result.value as Record<string, unknown>)
            : {}
          questions = (data as any).questions ?? result.result.value
          if (typeof questions === "string") {
            try {
              questions = JSON.parse(questions as string)
            } catch {
              questions = parseFlatQuestions(questions as string)
            }
          }
        } catch { questions = [] }
        onEvent({ type: "ask", questions })
        askedUser = true
      }

      // ── Special tool: create_artifact ───────────────────────
      if (call.name === "create_artifact" && result.result.type !== "error") {
        const data = typeof result.result.value === "object" && result.result.value !== null
          ? (result.result.value as Record<string, unknown>)
          : {}
        const artifact: Artifact = {
          id: generateId(),
          title: ((data as any).title as string) ?? "Untitled",
          type: ((data as any).type as Artifact["type"]) ?? "markdown",
          content: ((data as any).content as string) ?? "",
        }
        const { addArtifact } = await import("@/lib/engine/artifact-store")
        addArtifact(artifact)
        onEvent({ type: "artifact", artifact })
      }

      // ── Special tool: edit_artifact ─────────────────────────
      if (call.name === "edit_artifact" && result.result.type !== "error") {
        const { getArtifact } = await import("@/lib/engine/artifact-store")
        const updated = getArtifact((call.input as Record<string, unknown>).id as string)
        if (updated) onEvent({ type: "artifact", artifact: updated })
      }

      // ── Bound large tool outputs ────────────────────────────
      let boundedValue = result.result
      let boundedText = result.textOutput
      if (result.result.type !== "error") {
        const truncated = boundToolOutput(call.toolCallId, result.textOutput)
        boundedText = truncated as string
        if (truncated !== result.textOutput) {
          boundedValue = result.result.type === "json"
            ? { type: "json" as const, value: truncated }
            : { type: "text" as const, value: String(truncated) }
        }
      }
      const boundedResult = { ...result, textOutput: boundedText, result: boundedValue }

      // Create tool result part (added to conversation for ALL tools, including ask)
      const resultPart = {
        type: "tool-result" as const,
        id: generateId(),
        toolCallId: call.toolCallId,
        name: call.name,
        result: boundedResult.result,
      }

      conversation.push({ role: "tool", parts: [resultPart] })

      if (boundedResult.result.type === "error") {
        toolInstructions.push(
          `[Tool ${call.name} failed: ${boundedResult.result.value}. Try a different approach.]`
        )
      }

      // ── Interactive tools: skip tool-end + lifecyle events ──
      // For `ask`, the tool lifecycle pauses (waiting for user answers).
      // No tool-end is emitted — the timeline stays at "running".
      const isInteractiveTool = call.name === "ask" && boundedResult.result.type !== "error"

      if (!isInteractiveTool) {
        // Emit tool-end event for UI
        const toolStatus = boundedResult.result.type === "error" ? "error" : "verified"
        onEvent({
          type: "tool-end",
          tool: call.name,
          args: call.input,
          status: toolStatus,
          result: boundedResult.result.value,
          error: boundedResult.result.type === "error" ? String(boundedResult.result.value) : undefined,
          toolCallId: call.toolCallId,
        })

        // Record in doom loop tracker
        doomTracker.record(call.name, call.input as Record<string, unknown>)

        // Invalidate cache for write tools
        if (sessionCache && (call.name === "write_file" || call.name === "edit_file")) {
          sessionCache.invalidate(call.name, call.input as Record<string, unknown>)
        }
      }
    }

    // Log conversation state before next iteration
    console.log(`[loop] conversation state (${conversation.length} msgs):`)
    for (let ci = Math.max(0, conversation.length - 4); ci < conversation.length; ci++) {
      const m = conversation[ci]
      const tcs = m.parts.filter(p => p.type === "tool-call")
      const trs = m.parts.filter(p => p.type === "tool-result")
      const txts = m.parts.filter(p => p.type === "text")
      console.log(`[loop]   [${ci}] ${m.role}: txt=${txts.length} tc=${tcs.length}(${(tcs as any[]).map((t:any) => `${t.name}`).join(',')}) tr=${trs.length}(${(trs as any[]).map((t:any) => `${t.name}`).join(',')})`)
    }

    // Track whether tools were called this step (for context manager loop guard)
    lastStepHadToolCalls = activeCalls.length > 0

    // If we asked the user, pause — don't continue the loop
    if (askedUser) break

    // Update telemetry: reasoning time = total time minus tool dispatch time
    if (telemetry) {
      telemetry.stepCount = stepCount
      telemetry.apiTimeMs += results.reduce((sum, r) => sum + r.latencyMs, 0)
    }

    // Track consecutive tool failures for context manager
    const allErrors = results.every((r) => r.result.type === "error")
    if (allErrors && results.length > 0) {
      consecutiveToolFailures++

      // Guard: empty response loop protection (existing)
      if (!stepText && activeCalls.length > 0 && allErrors) {
        if (!accumulatedText) {
          accumulatedText = "I encountered errors while working on this task. Please rephrase or provide more details."
        }
        break
      }
    } else {
      consecutiveToolFailures = 0
    }

    // Inject tool results as LLMEvents into session so they appear in output
    for (const result of results) {
      for (const event of result.events) {
        session.handleEvent(event)
      }
    }
  }

  if (stepCount >= maxSteps && !accumulatedText) {
    accumulatedText = "I've reached the maximum number of steps. Please try a simpler request or ask me to continue."
  }

  session.dispose()

  // Finalize telemetry
  if (telemetry) {
    telemetry.stepCount = stepCount
    if (finalUsage) {
      telemetry.inputTokens = finalUsage.inputTokens ?? 0
      telemetry.outputTokens = finalUsage.outputTokens ?? 0
    }
  }

  return { text: accumulatedText, reasoning: accumulatedReasoning, usage: finalUsage, steps: stepCount, session }
}

// ─── Helpers ───────────────────────────────────

function toToolDefinitions(tools: Tools): ToolDefinition[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

function buildSystemMessage(basePrompt: string, failedToolInstructions: string[]): string {
  if (failedToolInstructions.length === 0) return basePrompt
  return `${basePrompt}\n\n${failedToolInstructions.join("\n")}`
}

/** Compact conversation by removing oldest tool results when context is full. */
function compactConversation(
  conversation: SessionMessage[],
  maxTokens: number,
): void {
  // Keep first (system) + last 3 user/assistant exchanges, remove tool results in between
  if (conversation.length <= 4) return

  const keepStart = Math.max(0, conversation.length - 6)
  const toRemove = conversation.slice(1, keepStart)
  let removed = 0

  for (const msg of toRemove) {
    if (msg.role === "tool") {
      const idx = conversation.indexOf(msg)
      if (idx > 0) {
        conversation.splice(idx, 1)
        removed++
      }
    }
  }
}
