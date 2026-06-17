import type { Message, AIProvider } from "@/types"
import { EventEmitter } from "./event-emitter"
import { AGENT_CONFIG, type ModeConfig } from "./modes"
import { buildSystemPrompt, buildContext, buildRequest } from "./context-builder"
import { planStep, type UsageInfo } from "./planner"
import { flushBatch } from "@/lib/db/batch"
import { executeTool } from "./executor"
import { verifyToolResult } from "./verifier"
import { TOOL_REGISTRY, type ToolImplementation } from "./tools"
import { ToolIsolationService } from "./tool-isolation-service"
import { CompactionService } from "./compaction-service"
import { createStep } from "@/lib/db/adapter"

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export class NightCodeEngine {
  private emitter = new EventEmitter()

  subscribe(fn: (event: string, data: unknown) => void): () => void {
    return this.emitter.subscribe(fn)
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    this.emitter.emit("engine_event", {
      type,
      payload,
      timestamp: Date.now(),
    })
  }

  async run(
    messages: Message[],
    messageId: string,
    provider: AIProvider,
    model: string,
    signal: AbortSignal,
    skillInjected?: string,
    mcpTools?: ToolImplementation[],
    toolIsolation?: ToolIsolationService,
    compactionService?: CompactionService
  ): Promise<void> {
    const config: ModeConfig = AGENT_CONFIG

    const basePrompt = buildSystemPrompt(mcpTools)
    const fullSystemPrompt = skillInjected
      ? basePrompt + "\n\n" + skillInjected
      : basePrompt

    if (skillInjected) {
      console.log("Skill content injected, preview:", skillInjected.substring(0, 200))
    } else {
      console.log("No skills injected for this message")
    }

    // Build available tools
    let availableTools: ToolImplementation[] = config.tools
      .map((t) => TOOL_REGISTRY[t.name])
      .filter(Boolean)

    if (mcpTools) {
      availableTools = [...availableTools, ...mcpTools]
    }

    // Build request — separate system prompt from conversation messages
    const { system: requestSystemPrompt, messages: initialMessages } = buildRequest(messages, fullSystemPrompt, messageId)

    // ── Manual step loop ─────────────────────────────────────────────────────
    // Each iteration:
    //   1. Call planStep() — single LLM call (tools registered without execute)
    //   2. If model returns text → done, emit final
    //   3. If model returns tool calls → execute each, verify, persist to DB
    //   4. Build tool result messages, rebuild context, loop

    let currentMessages: Array<{ role: string; content: unknown }> = initialMessages.map((m) => ({ role: m.role, content: m.content }))
    let stepNumber = 0
    const MAX_STEPS = config.maxIterations
    let toolCallCount = 0
    let finalText = ""
    let consecutiveErrors = 0

    try {
      while (stepNumber < MAX_STEPS) {
        if (signal.aborted) break

        stepNumber++
        const stepId = `step_${stepNumber}_${generateId().slice(0, 8)}`
        console.log(`[engine] Step ${stepNumber}/${MAX_STEPS} starting`)

        // Notify isolation service which step we're on
        toolIsolation?.setStepId(stepId)

        // ── 1. Single LLM call ────────────────────────────────────────────────
        const step = await planStep(
          currentMessages,
          provider,
          model,
          availableTools,
          {
            onText: (text) => {
              this.emitEvent("text_delta", { text })
            },
          },
          signal,
          requestSystemPrompt
        )

        if (step.usage) {
          this.emitEvent("usage", {
            provider,
            model,
            inputTokens: step.usage.inputTokens,
            outputTokens: step.usage.outputTokens,
            reasoningTokens: step.usage.reasoningTokens ?? 0,
          })
        }

        flushBatch()

        if (signal.aborted) break

        // Persist step record BEFORE tool execution — tool isolation references step_id
        createStep({
          id: stepId,
          session_id: messageId,
          step_number: stepNumber,
          input_tokens: null,
          output_tokens: null,
          finish_reason: step.type === "text" ? "stop" : "tool_calls",
          created_at: Date.now(),
        })

        // ── 2. Text response → done ────────────────────────────────────────────
        if (step.type === "text") {
          finalText = step.content

          console.log(`[engine] Done. ${toolCallCount} total tool calls across ${stepNumber} steps. Final text length: ${finalText.length}`)
          this.emitEvent("thinking", { text: finalText, toolCallCount })
          compactionService?.onStepComplete(stepNumber, provider, model)
          break
        }

        // ── 3. Tool calls → execute in parallel ─────────────────────────────
        const toolResultMessages: Array<{ role: "tool"; content: Array<{ type: "tool-result"; toolCallId: string; toolName: string; output: unknown }> }> = []
        let asked = false
        let roundFailed = 0
        let roundTotal = 0

        // Map tool calls with pre-assigned IDs and resolve tool definitions
        const normalize = (n: string) => n.replace(/-/g, "_").toLowerCase()
        const calls = step.toolCalls.map((tc) => {
          toolCallCount++
          const toolDef = availableTools.find((t) => normalize(t.name) === normalize(tc.toolName))
          const generatedId = toolIsolation?.onToolStart(tc.toolName, tc.args, toolCallCount) ?? `tool_${toolCallCount}_${generateId().slice(0, 8)}`
          return { ...tc, toolDef, generatedId }
        })

        // Handle unknown tools immediately
        for (const tc of calls) {
          if (tc.toolDef) continue
          const msg = `Tool "${tc.toolName}" not found. Available: ${availableTools.map((t) => t.name).join(", ")}`
          this.emitEvent("error", { message: msg })
          toolResultMessages.push({
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: { type: "json" as const, value: { error: msg } },
            }],
          })
          roundFailed++
          roundTotal++
        }

        const validCalls = calls.filter((tc) => tc.toolDef)

        // Emit all tool_start events immediately
        for (const tc of validCalls) {
          this.emitEvent("tool_start", { tool: tc.toolName, args: tc.args, callNumber: toolCallCount, toolCallId: tc.generatedId })
        }

        // Execute all valid tools in parallel
        const execResults = await Promise.all(
          validCalls.map(async (tc) => {
            if (tc.toolName === "ask") {
              asked = true
              try {
                const questions = typeof tc.args.questions === "string" ? JSON.parse(tc.args.questions) : tc.args.questions
                this.emitEvent("ask", { questions })
              } catch {
                this.emitEvent("ask", { questions: [] })
              }
              return { tc, skipResult: true } as const
            }

            if (consecutiveErrors >= 2 && tc.toolDef!.name !== "think") {
              const forcedThink = {
                success: true,
                data: {
                  thought: `The last ${consecutiveErrors} tool calls failed. I should stop and reassess what went wrong before trying again.`,
                },
              }
              return { tc, skipResult: false, success: true, data: forcedThink.data, forcedThink: true } as const
            }

            const execResult = await executeTool(tc.toolDef!, tc.args)
            return { tc, ...execResult, skipResult: false, forcedThink: false } as const
          })
        )

        // Process all results
        for (const result of execResults) {
          const { tc, skipResult } = result

          if (skipResult) {
            roundTotal++
            continue
          }

          if (result.forcedThink) {
            roundFailed++
            roundTotal++
            toolResultMessages.push({
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: "json" as const, value: result.data },
              }],
            })
            continue
          }

          if (!result.success) {
            roundFailed++
            roundTotal++
            this.emitEvent("tool_end", {
              tool: tc.toolName,
              args: tc.args,
              status: "error",
              error: result.error,
              toolCallId: tc.generatedId,
            })
            toolIsolation?.onToolEnd(tc.generatedId, tc.toolName, false, null, result.error ?? "Tool execution failed", null, undefined)
            toolResultMessages.push({
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: "json" as const, value: { error: result.error } },
              }],
            })
            continue
          }

          const verification = await verifyToolResult(tc.toolDef!, tc.args, { success: true, data: result.data })

          if (verification.verified) {
            if (tc.toolName === "create_artifact") {
              const { addArtifact } = await import("@/lib/engine/artifact-store")
              const artifact = {
                id: generateId(),
                title: (tc.args.title as string) ?? "Untitled",
                type: (tc.args.type as "markdown" | "code" | "html" | "svg" | "mermaid") ?? "markdown",
                content: (tc.args.content as string) ?? "",
              }
              addArtifact(artifact)
              this.emitEvent("artifact", { artifact })
            }

            if (tc.toolName === "edit_artifact") {
              const { getArtifact } = await import("@/lib/engine/artifact-store")
              const updated = getArtifact(tc.args.id as string)
              if (updated) {
                this.emitEvent("artifact", { artifact: updated })
              }
            }

            this.emitEvent("tool_end", {
              tool: tc.toolName,
              args: tc.args,
              status: "verified",
              result: result.data,
              evidence: verification.evidence,
              callNumber: toolCallCount,
              toolCallId: tc.generatedId,
            })

            const toolResult = toolIsolation
              ? toolIsolation.onToolEnd(tc.generatedId, tc.toolName, true, result.data, null, result.data?.executionTime ?? null, verification.evidence)
              : result.data

            toolResultMessages.push({
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: "json" as const, value: toolResult },
              }],
            })

            roundTotal++
          } else {
            roundFailed++
            roundTotal++
            this.emitEvent("tool_end", {
              tool: tc.toolName,
              args: tc.args,
              status: "verification_failed",
              discrepancy: verification.discrepancy,
              toolCallId: tc.generatedId,
            })
            toolIsolation?.onToolEnd(tc.generatedId, tc.toolName, false, null, `Verification failed: ${verification.discrepancy}`, null, undefined)
            toolResultMessages.push({
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: "json" as const, value: { error: `Verification failed: ${verification.discrepancy}` } },
              }],
            })
          }
        }

        // Update consecutive errors based on round failure rate
        if (roundTotal > 0 && (roundFailed / roundTotal) > 0.5) {
          consecutiveErrors++
          console.log(`[engine] Round failure rate ${roundFailed}/${roundTotal} > 50%, consecutiveErrors=${consecutiveErrors}`)
        } else {
          consecutiveErrors = 0
        }

        // ── 4. If model asked questions, pause conversation ────────────────
        if (asked) break

        // ── 5. Trigger compaction if enough steps have passed ──────────────
        compactionService?.onStepComplete(stepNumber, provider, model)

        // ── 6. Rebuild context for next iteration ───────────────────────────
        // Structure feeds back to the model:
        //   assistant message (with text + tool calls)
        //   + tool result messages (from execution)
        const assistantContent: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown }> = []
        if (step.text) {
          assistantContent.push({ type: "text", text: step.text })
        }
        for (const tc of step.toolCalls) {
          assistantContent.push({
            type: "tool-call",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.args,
          })
        }
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: assistantContent },
          ...toolResultMessages,
        ]

        console.log(`[engine] Step ${stepNumber} complete: ${step.toolCalls.length} tool calls, context now ${currentMessages.length} messages`)
        flushBatch()
      }

      if (stepNumber >= MAX_STEPS && !finalText) {
        finalText = "I've reached the maximum number of steps for this request. Please try a simpler request or ask me to continue."
        this.emitEvent("thinking", { text: finalText, toolCallCount })
      }

    } catch (err) {
      if (signal.aborted) return
      this.emitEvent("error", {
        message: `Engine error: ${err instanceof Error ? err.message : "Unknown error"}`,
      })
    } finally {
      flushBatch()
      console.log("Emitting message_complete event")
      this.emitEvent("message_complete", {})
    }
  }
}
