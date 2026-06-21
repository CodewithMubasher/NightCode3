import type { Message, AIProvider } from "@/types"
import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "./event-emitter"
import { AGENT_CONFIG, type ModeConfig } from "./modes"
import { buildSystemPrompt, buildContext, buildRequest } from "./context-builder"
import { planStep, type UsageInfo } from "./planner"
import { flushBatch } from "@/lib/db/batch"
import { executeTool } from "./executor"
import { verifyToolResult } from "./verifier"
import type { VerificationResult } from "./tools"
import { TOOL_REGISTRY, type ToolImplementation } from "./tools"
import { ToolIsolationService } from "./tool-isolation-service"
import { CompactionService } from "./compaction-service"
import { createStep, createFileSnapshot } from "@/lib/db/adapter"
import type { DBFileSnapshot } from "@/lib/db/types"

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function countFilesRecursive(dir: string): number {
  let count = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        count += countFilesRecursive(fullPath)
      } else {
        count++
      }
    }
  } catch {}
  return count
}

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

export interface EngineRunOptions {
  depth?: number
  silent?: boolean
  tools?: string[]
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

  private async takeFileSnapshot(toolName: string, args: Record<string, unknown>, toolCallId: string, sessionId: string): Promise<void> {
    const rawPath = args.path as string | undefined
    if (!rawPath) return

    const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(WORKSPACE, rawPath)
    const resolved = path.normalize(candidate)
    if (!resolved.startsWith(WORKSPACE)) {
      throw new Error(`Path traversal denied: "${rawPath}" is outside the workspace`)
    }
    let originalContent: string | null = null
    let existedBefore = 1

    try {
      if (toolName === "write_file") {
        existedBefore = fs.existsSync(resolved) ? 1 : 0
      } else if (toolName === "delete_file") {
        if (fs.existsSync(resolved)) {
          originalContent = fs.readFileSync(resolved, "utf-8")
        } else {
          existedBefore = 0
        }
      } else if (toolName === "create_folder") {
        existedBefore = fs.existsSync(resolved) ? 1 : 0
      }
    } catch {
      existedBefore = 0
    }

    const snapshot: DBFileSnapshot = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      session_id: sessionId,
      tool_call_id: toolCallId,
      tool_name: toolName,
      file_path: rawPath,
      original_content: originalContent,
      existed_before: existedBefore,
      created_at: Date.now(),
    }

    createFileSnapshot(snapshot)
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
    compactionService?: CompactionService,
    options?: EngineRunOptions
  ): Promise<string> {
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

    // Add delegate_task for orchestrator (not sub-agents)
    const delegateTaskTool = TOOL_REGISTRY["delegate_task"]
    if (delegateTaskTool && (!options?.depth || options.depth < 1)) {
      availableTools = [...availableTools, delegateTaskTool]
    }

    if (mcpTools) {
      availableTools = [...availableTools, ...mcpTools]
    }

    if (options?.tools) {
      const allowed = new Set(options.tools)
      availableTools = availableTools.filter((t) => allowed.has(t.name))
    }

    // Build request — separate system prompt from conversation messages
    const { system: requestSystemPrompt, messages: initialMessages } = buildRequest(messages, fullSystemPrompt, messageId)

    // ── Manual step loop ─────────────────────────────────────────────────────
    // Each iteration:
    //   1. Call planStep() — single LLM call (tools registered without execute)
    //   2. If model returns text → done, emit final
    //   3. If model returns tool calls → execute each, verify, persist to DB
    //   4. Build tool result messages, rebuild context, loop

    let currentMessages: Array<{ role: string; content: unknown }> = initialMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : m.content,
    }))
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

        if (!options?.silent) {
          createStep({
            id: stepId,
            session_id: messageId,
            step_number: stepNumber,
            input_tokens: null,
            output_tokens: null,
            finish_reason: step.type === "text" ? "stop" : "tool_calls",
            created_at: Date.now(),
          })
        }

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
        const toolAliases: Record<string, string> = {
          create_file: "write_file",
          make_file: "write_file",
          new_file: "write_file",
          create_directory: "create_folder",
          make_folder: "create_folder",
          remove_file: "delete_file",
          list_files: "list_directory",
          search_code: "search_files",
        }
        const calls = step.toolCalls.map((tc) => {
          toolCallCount++
          const resolvedName = toolAliases[tc.toolName] ?? tc.toolName
          const toolDef = availableTools.find((t) => normalize(t.name) === normalize(resolvedName))
          const generatedId = toolIsolation?.onToolStart(tc.toolName, tc.args, toolCallCount) ?? `tool_${toolCallCount}_${generateId().slice(0, 8)}`
          let args = tc.args
          if (resolvedName === "delegate_task") {
            args = { ...args, __provider: provider, __model: model, __depth: options?.depth ?? 0, __abortSignal: signal }
          }
          return { ...tc, toolDef, generatedId, args, resolvedName }
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

            if (tc.resolvedName === "delete_file") {
              asked = true
              let fileCount = 0
              try {
                const rawPath = tc.args.path as string
                const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(WORKSPACE, rawPath)
                const resolved = path.normalize(candidate)
                if (resolved.startsWith(WORKSPACE) && fs.existsSync(resolved)) {
                  const stat = fs.statSync(resolved)
                  if (stat.isDirectory()) {
                    fileCount = countFilesRecursive(resolved)
                  } else {
                    fileCount = 1
                  }
                }
              } catch {}
              this.emitEvent("confirmation", { path: tc.args.path, fileCount, toolCallId: tc.generatedId })
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

            if (!options?.silent && ["write_file", "create_folder"].includes(tc.resolvedName)) {
              await this.takeFileSnapshot(tc.resolvedName, tc.args, tc.generatedId, messageId)
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

          let verification: VerificationResult
          try {
            verification = await verifyToolResult(tc.toolDef!, tc.args, { success: true, data: result.data })
          } catch (err) {
            verification = { verified: false, discrepancy: `Verification threw: ${err instanceof Error ? err.message : "Unknown error"}` }
          }

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

        // ── 5. Trigger compaction if enough steps have passed ──────────────
        compactionService?.onStepComplete(stepNumber, provider, model)

        // ── 4. If model asked questions, pause conversation ────────────────
        flushBatch()
        if (asked) break

        // ── 6. Rebuild context for next iteration ───────────────────────────
        // Structure feeds back to the model:
        //   assistant message (with text + tool calls)
        //   + tool result messages (from execution)
        const assistantContent: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown }> = []
        if (step.text) {
          assistantContent.push({ type: "text", text: step.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() })
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

      return finalText
    } catch (err) {
      if (signal.aborted) return ""
      this.emitEvent("error", {
        message: `Engine error: ${err instanceof Error ? err.message : "Unknown error"}`,
      })
      return `Engine error: ${err instanceof Error ? err.message : "Unknown error"}`
    } finally {
      flushBatch()
      console.log("Emitting message_complete event")
      this.emitEvent("message_complete", {})
    }
  }
}
