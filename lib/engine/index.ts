import type { Message, AIProvider } from "@/types"
import { EventEmitter } from "./event-emitter"
import { AGENT_CONFIG, type ModeConfig } from "./modes"
import { buildSystemPrompt, buildContext } from "./context-builder"
import { planStep } from "./planner"
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

    // Build initial context — system prompt + conversation history
    const initialContext = buildContext(messages, fullSystemPrompt)

    // ── Manual step loop ─────────────────────────────────────────────────────
    // Each iteration:
    //   1. Call planStep() — single LLM call (tools registered without execute)
    //   2. If model returns text → done, emit final
    //   3. If model returns tool calls → execute each, verify, persist to DB
    //   4. Build tool result messages, rebuild context, loop

    let currentMessages: Array<{ role: string; content: unknown }> = initialContext
    let stepNumber = 0
    const MAX_STEPS = config.maxIterations
    let toolCallCount = 0
    let finalText = ""

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
          signal
        )

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

        // ── 3. Tool calls → execute each ──────────────────────────────────────
        const toolResultMessages: Array<{ role: "tool"; content: Array<{ type: "tool-result"; toolCallId: string; toolName: string; output: unknown }> }> = []

        for (const tc of step.toolCalls) {
          toolCallCount++

          const normalize = (n: string) => n.replace(/-/g, "_").toLowerCase()
          const toolDef = availableTools.find(
            (t) => normalize(t.name) === normalize(tc.toolName)
          )

          if (!toolDef) {
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
            continue
          }

          // Track via isolation service (stores to DB) — generates unique toolCallId
          const toolCallId = toolIsolation?.onToolStart(tc.toolName, tc.args, toolCallCount) ?? `tool_${toolCallCount}_${generateId().slice(0,8)}`

          this.emitEvent("tool_start", { tool: tc.toolName, args: tc.args, callNumber: toolCallCount, toolCallId })

          const execResult = await executeTool(toolDef, tc.args)

          if (execResult.success) {
            const verification = await verifyToolResult(toolDef, tc.args, execResult)

            if (verification.verified) {
              if (tc.toolName === "create_artifact") {
                this.emitEvent("artifact", {
                  artifact: {
                    id: generateId(),
                    title: (tc.args.title as string) ?? "Untitled",
                    type: (tc.args.type as "markdown" | "code" | "html" | "svg" | "mermaid") ?? "markdown",
                    content: (tc.args.content as string) ?? "",
                  },
                })
              }

              this.emitEvent("tool_end", {
                tool: tc.toolName,
                args: tc.args,
                status: "verified",
                result: execResult.data,
                evidence: verification.evidence,
                callNumber: toolCallCount,
                toolCallId,
              })

              const toolResult = toolIsolation
                ? toolIsolation.onToolEnd(
                    toolCallId, tc.toolName, true, execResult.data, null,
                    execResult.data?.executionTime ?? null, verification.evidence
                  )
                : execResult.data

              toolResultMessages.push({
                role: "tool",
                content: [{
                  type: "tool-result",
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  output: { type: "json" as const, value: toolResult },
                }],
              })

            } else {
              this.emitEvent("tool_end", {
                tool: tc.toolName,
                args: tc.args,
                status: "verification_failed",
                discrepancy: verification.discrepancy,
                toolCallId,
              })
              toolIsolation?.onToolEnd(
                toolCallId, tc.toolName, false, null,
                `Verification failed: ${verification.discrepancy}`, null, undefined
              )

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
          } else {
            this.emitEvent("tool_end", {
              tool: tc.toolName,
              args: tc.args,
              status: "error",
              error: execResult.error,
            })
            toolIsolation?.onToolEnd(
              toolCallId, tc.toolName, false, null, execResult.error ?? "Tool execution failed", null, undefined
            )

            toolResultMessages.push({
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: "json" as const, value: { error: execResult.error } },
              }],
            })
          }
        }

        // ── 4b. Trigger compaction if enough steps have passed ─────────────
        compactionService?.onStepComplete(stepNumber, provider, model)

        // ── 5. Rebuild context for next iteration ───────────────────────────
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
      console.log("Emitting message_complete event")
      this.emitEvent("message_complete", {})
    }
  }
}
