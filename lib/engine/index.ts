import type { Message, AIProvider } from "@/types"
import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "./event-emitter"
import { AGENT_CONFIG, CAAT_CONFIG, PLAN_CONFIG, type ModeConfig } from "./modes"
import { buildSystemPrompt, buildContext, buildRequest, buildDynamicBlock, invalidateCompactionCache } from "./context-builder"
import { planStep, type UsageInfo } from "./planner"
import { flushBatch } from "@/lib/db/batch"
import { executeTool } from "./executor"
import { verifyToolResult } from "./verifier"
import type { VerificationResult } from "./tools"
import { TOOL_REGISTRY, type ToolImplementation } from "./tools"
import { ToolIsolationService } from "./tool-isolation-service"
import { CompactionService } from "./compaction-service"
import { Semaphore } from "./semaphore"
import { classifyIntent } from "./intent-classifier"
import { createStep, createFileSnapshot } from "@/lib/db/adapter"
import type { DBFileSnapshot } from "@/lib/db/types"
import { boundToolOutput } from "./tool-output-store"
import { DoomLoopTracker } from "./doom-loop-tracker"
import { classifyTools } from "./tool-classifier"
import { needsPermission, rememberPermission } from "./permission"

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 7)
}

function estimateMessageTokens(msg: { role: string; content: unknown }): number {
  if (typeof msg.content === "string") return estimateTokens(msg.content)
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((acc, part) => {
      if (typeof part === "object" && part !== null) {
        const p = part as Record<string, unknown>
        if (p.type === "text" && typeof p.text === "string") return acc + estimateTokens(p.text)
        if (p.type === "tool-call" && p.input) return acc + estimateTokens(JSON.stringify(p.input))
        if (p.type === "tool-result") return acc + 20 // tool results are summarized, don't double-count
      }
      return acc
    }, 0)
  }
  return 0
}

const CLEAR_THRESHOLD_TOKENS = 12000
const PROTECTED_TOOLS = new Set(["skill"])

function clearOldToolOutputs(messages: Array<{ role: string; content: unknown }>, keepRecent = 2, mode?: string): number {
  if (mode === "plan") return 0 // never clear during PLAN mode — model needs all investigation context
  let cleared = 0
  const toolMessages = messages
    .map((m, i) => ({ msg: m, index: i }))
    .filter(({ msg }) => msg.role === "tool" && Array.isArray(msg.content))

  if (toolMessages.length <= keepRecent) return 0

  const toClear = toolMessages.slice(0, -keepRecent)
  for (const { msg } of toClear) {
    const parts = msg.content as Array<Record<string, unknown>>
    for (const part of parts) {
      if (part.type !== "tool-result") continue
      const toolName = part.toolName as string
      if (PROTECTED_TOOLS.has(toolName)) continue
      const output = part.output as Record<string, unknown> | undefined
      if (!output || typeof output !== "object") continue
      const val = output.value
      if (typeof val === "string" && val.length > CLEAR_THRESHOLD_TOKENS) {
        part.output = { type: "json" as const, value: `[Tool result processed: ${toolName}]` }
        cleared++
      } else if (typeof val === "object" && val !== null) {
        const str = JSON.stringify(val)
        if (str.length > CLEAR_THRESHOLD_TOKENS) {
          part.output = { type: "json" as const, value: `[Tool result processed: ${toolName}]` }
          cleared++
        }
      }
    }
  }
  return cleared
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
  mode?: "standard" | "caat"
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
    const mode = options?.mode ?? "standard"
    let currentMode: string = mode
    if (mode === "standard") {
      const lastUserMsg = messages.filter((m) => m.role === "user").pop()
      const intent = lastUserMsg ? classifyIntent(lastUserMsg.content) : "quick"
      currentMode = intent === "deep" ? "plan" : "standard"
    }
    let currentConfig: ModeConfig = currentMode === "caat" ? CAAT_CONFIG : currentMode === "plan" ? PLAN_CONFIG : AGENT_CONFIG

    const basePrompt = buildSystemPrompt(currentMode, mcpTools, model)
    const fullSystemPrompt = skillInjected
      ? basePrompt + "\n\n" + skillInjected
      : basePrompt

    if (skillInjected) {
      console.log("Skill content injected, preview:", skillInjected.substring(0, 200))
    } else {
      console.log("No skills injected for this message")
    }

    // Build available tools
    let availableTools: ToolImplementation[] = currentConfig.tools
      .map((t) => TOOL_REGISTRY[t.name])
      .filter(Boolean)

    // Add expert_agent for orchestrator (spawns CaaT sub-agent)
    const expertAgentToolRef = TOOL_REGISTRY["expert_agent"]
    if (expertAgentToolRef && (!options?.depth || options.depth < 1)) {
      availableTools = [...availableTools, expertAgentToolRef]
    }

    if (mcpTools) {
      availableTools = [...availableTools, ...mcpTools]
    }

    if (options?.tools) {
      const allowed = new Set(options.tools)
      availableTools = availableTools.filter((t) => allowed.has(t.name))
    }

    const userMessage = messages[messages.length - 1]
    if (userMessage && userMessage.role === "user" && typeof userMessage.content === "string") {
      const before = availableTools.length
      availableTools = classifyTools(userMessage.content, availableTools)
      console.log(`[engine] Tool filtering: ${before} → ${availableTools.length} tools`)
    }

    // Build request — separate system prompt from conversation messages
    const built = buildRequest(messages, fullSystemPrompt, messageId)
    const requestSystemPrompt = built.system
    const initialMessages = built.messages

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
    const MAX_STEPS = currentConfig.maxIterations
    let toolCallCount = 0
    let finalText = ""
    let consecutiveErrors = 0
    let malformedCount = 0
    let cumulativeInputTokens = 0
    let cumulativeOutputTokens = 0
    let cumulativeReasoningTokens = 0
    let totalDurationMs = 0
    // Track which step produced which messages so we can remove them post-compaction
    const stepMessages = new Map<number, Array<{ role: string; content: unknown }>>()
    // Investigation state for PLAN mode — persists across steps
    const investigation = {
      visitedFiles: new Set<string>(),
      visitedDirs: new Set<string>(),
      discoveredFacts: new Set<string>(),
      toolCallHistory: new Array<{ tool: string; args: string }>(),
      addFile(file: string) { this.visitedFiles.add(file) },
      addDir(dir: string) { this.visitedDirs.add(dir) },
      addFact(fact: string) { this.discoveredFacts.add(fact) },
      hasVisited(file: string) { return this.visitedFiles.has(file) },
      alreadyCalled(tool: string, args: Record<string, unknown>): boolean {
        const key = `${tool}::${JSON.stringify(args)}`
        if (this.toolCallHistory.some((t) => `${t.tool}::${t.args}` === key)) return true
        this.toolCallHistory.push({ tool, args: JSON.stringify(args) })
        return false
      },
      getSummary(): string {
        const files = [...this.visitedFiles].join(", ")
        const dirs = [...this.visitedDirs].join(", ")
        const facts = [...this.discoveredFacts].join("\n")
        if (!files && !dirs) return ""
        let s = "Already investigated:\n"
        if (dirs) s += `  Directories: ${dirs}\n`
        if (files) s += `  Files: ${files}\n`
        if (facts) s += `\nKnown facts:\n${facts}\n`
        return s
      },
    }
    // Bounded concurrency for parallel tool execution — max 5 concurrent I/O ops
    const toolSem = new Semaphore(5)

    try {
      while (stepNumber < MAX_STEPS) {
        if (signal.aborted) break

        stepNumber++
        const stepId = `step_${stepNumber}_${generateId().slice(0, 8)}`
        console.log(`[engine] Step ${stepNumber}/${MAX_STEPS} starting`)

        // Notify isolation service which step we're on
        toolIsolation?.setStepId(stepId)

        // ── 1. Single LLM call ────────────────────────────────────────────────
        const preCallTokens = currentMessages.reduce((acc, m) => acc + estimateMessageTokens(m), 0)
        if (preCallTokens > 8000) {
          const before = currentMessages.length
          const cleared = clearOldToolOutputs(currentMessages, 1, currentMode)
          if (cleared > 0) {
            console.log(`[engine] Pre-call overflow prevention: cleared ${cleared} old tool outputs (${before} msgs)`)
          }
        }

        const stepStartTime = performance.now()

        // Inject investigation state for PLAN mode
        if (currentMode === "plan" && stepNumber > 1) {
          const summary = investigation.getSummary()
          if (summary) {
            currentMessages.push({
              role: "user",
              content: `[Investigation Status]\n${summary}\nDo NOT re-read these files. Continue investigating unexplored areas.`,
            })
          }
        }

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
          const stepDurationMs = performance.now() - stepStartTime
          totalDurationMs += stepDurationMs
          const outputTokensPerSec = stepDurationMs > 0
            ? Math.round((step.usage.outputTokens / stepDurationMs) * 1000)
            : 0
          cumulativeInputTokens += step.usage.inputTokens
          cumulativeOutputTokens += step.usage.outputTokens
          cumulativeReasoningTokens += (step.usage.reasoningTokens ?? 0)
          this.emitEvent("usage", {
            provider,
            model,
            inputTokens: step.usage.inputTokens,
            outputTokens: step.usage.outputTokens,
            reasoningTokens: step.usage.reasoningTokens ?? 0,
            outputTokensPerSec,
            cumulativeInputTokens,
            cumulativeOutputTokens,
            cumulativeReasoningTokens,
            stepDurationMs: Math.round(stepDurationMs),
          })
        }

        flushBatch()

        if (signal.aborted) break

        if (!options?.silent) {
          createStep({
            id: stepId,
            session_id: messageId,
            step_number: stepNumber,
            input_tokens: step.usage?.inputTokens ?? null,
            output_tokens: step.usage?.outputTokens ?? null,
            finish_reason: step.type === "text" ? "stop" : "tool_calls",
            created_at: Date.now(),
          })
        }

        // ── 2. Text response → done ────────────────────────────────────────────
        if (step.type === "text") {
          finalText = step.content

          console.log(`[engine] Done. ${toolCallCount} total tool calls across ${stepNumber} steps. Final text length: ${finalText.length}`)
          compactionService?.onStepComplete(stepNumber, provider, model)
          break
        }

        // ── 3. Tool calls → execute in parallel ─────────────────────────────
        const toolResultMessages: Array<{ role: "tool"; content: Array<{ type: "tool-result"; toolCallId: string; toolName: string; output: unknown }> }> = []
        let asked = false
        let roundFailed = 0
        let roundTotal = 0

        const doomLoopTracker = new DoomLoopTracker()

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
          const generatedId = toolIsolation?.registerToolCall(tc.toolName, tc.args, toolCallCount) ?? `tool_${toolCallCount}_${generateId().slice(0, 8)}`
          let args = tc.args
          if (args === null || args === undefined) {
            const msg = `Malformed tool call: ${tc.toolName} received invalid arguments. The model produced broken JSON.`
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
            malformedCount++
            roundFailed++
            roundTotal++
            return { tc, toolDef, generatedId, args: null, resolvedName, malformed: true } as const
          }
          if (resolvedName === "expert_agent") {
            args = { ...args, __emitEvent: this.emitEvent.bind(this), __abortSignal: signal }
          }
          doomLoopTracker.record(tc.toolName, tc.args)
          return { ...tc, toolDef, generatedId, args, resolvedName, malformed: false } as const
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

        const validCalls = calls.filter((tc) => tc.toolDef && !tc.malformed)
        const malformedCalls = calls.filter((tc) => tc.malformed)

        if (malformedCount >= 2) {
          finalText = "The model keeps producing malformed tool calls. Stopping to prevent a doom loop. Please try a simpler request."
          break
        }

        if (malformedCalls.length > 0 && validCalls.length === 0) {
          break
        }

        for (const tc of validCalls) {
          toolIsolation?.markRunning(tc.generatedId, tc.toolName)
          this.emitEvent("tool_start", { tool: tc.toolName, args: tc.args, callNumber: toolCallCount, toolCallId: tc.generatedId })
        }

        // Execute all valid tools in parallel (bounded to 5 concurrent)
        const execResults = await Promise.all(
          validCalls.map((tc) => toolSem.run(async () => {
            // Doom loop check — 3 consecutive identical tool+args
            const doomCheck = doomLoopTracker.check(tc.toolName, tc.args)
            if (doomCheck.isDoomLoop) {
              return {
                tc,
                skipResult: false,
                success: false,
                forcedThink: false,
                error: `Doom loop detected: tool "${tc.toolName}" called with identical arguments ${doomCheck.matchedCount + 1} times. Use a different approach.`,
              } as const
            }

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

            if (consecutiveErrors >= 2) {
              const forcedThink = {
                success: true,
                data: {
                  thought: `The last ${consecutiveErrors} tool calls failed. I should stop and reassess what went wrong before trying again.`,
                },
              }
              return { tc, skipResult: false, success: true, data: forcedThink.data, forcedThink: true } as const
            }

            const permRequest = needsPermission(tc.toolName, tc.args)
            if (permRequest) {
              this.emitEvent("permission", { tool: tc.toolName, args: tc.args, reason: permRequest.reason, toolCallId: tc.generatedId })
              return { tc, skipResult: true } as const
            }

            if (!options?.silent && ["write_file", "create_folder"].includes(tc.resolvedName)) {
              await this.takeFileSnapshot(tc.resolvedName, tc.args, tc.generatedId, messageId)
            }

            // Duplicate detection: skip re-reading same file in PLAN mode
            const fileArg = tc.args.path as string | undefined
            if (currentMode === "plan" && tc.toolName === "read_file" && fileArg && investigation.hasVisited(fileArg)) {
              return {
                tc,
                success: true,
                data: { content: `[Already read: ${fileArg}. This file was already investigated. Move on to unexplored areas.]` },
                skipResult: false,
                forcedThink: false,
              } as const
            }

            const execResult = await executeTool(tc.toolDef!, tc.args)
            return { tc, ...execResult, skipResult: false, forcedThink: false } as const
          }))
        )

        // Process all results — state: running → completed | error
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
              callNumber: toolCallCount,
              toolCallId: tc.generatedId,
            })
            toolIsolation?.completeTool(tc.generatedId, tc.toolName, false, null, result.error ?? "Tool execution failed", null, undefined)
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
              ? toolIsolation.completeTool(tc.generatedId, tc.toolName, true, result.data, null, (result as any).executionTime ?? null, verification.evidence)
              : boundToolOutput(tc.generatedId, result.data)

            toolResultMessages.push({
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: "json" as const, value: toolResult },
              }],
            })

            // Track investigation state for PLAN mode
            if (currentMode === "plan") {
              const path = tc.args.path as string | undefined
              const pattern = tc.args.pattern as string | undefined
              if (tc.toolName === "read_file" && path) {
                investigation.addFile(path)
                if (result.data?.content) {
                  const content = result.data.content as string
                  if (content.includes("version") || content.includes("dependencies")) {
                    investigation.addFact(`${path}: package manifest with dependencies`)
                  }
                  if (content.includes("module") || content.includes("import") || content.includes("require")) {
                    investigation.addFact(`${path}: application code`)
                  }
                }
              }
              if (tc.toolName === "list_directory" && path) {
                investigation.addDir(path)
                const items = (result.data?.items ?? []) as Array<{ name: string; type: string }>
                for (const item of items.filter((i) => i.type === "file")) {
                  if (/package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|Makefile|docker|Dockerfile|\.config\./i.test(item.name)) {
                    investigation.addFact(`Found config file: ${path}/${item.name}`)
                  }
                }
              }
            }

            roundTotal++
          } else {
            roundFailed++
            roundTotal++
            this.emitEvent("tool_end", {
              tool: tc.toolName,
              args: tc.args,
              status: "error",
              error: `Verification failed: ${verification.discrepancy}`,
              callNumber: toolCallCount,
              toolCallId: tc.generatedId,
            })
            toolIsolation?.completeTool(tc.generatedId, tc.toolName, false, null, `Verification failed: ${verification.discrepancy}`, null, undefined)
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

        // Mode switch: plan → build on plan_exit success
        if (currentMode === "plan") {
          const planExitResult = execResults.find(
            (r) => r.tc.toolName === "plan_exit" && r.success && r.data?._switchMode === "build"
          )
          if (planExitResult) {
            const planSummary = planExitResult.data.planSummary ?? ""
            // Verification gate: check if planner gathered meaningful information
            const hasSubstance = planSummary.length > 50 &&
              (planSummary.includes("project") || planSummary.includes("package") || planSummary.includes("app") || planSummary.includes("src") || planSummary.includes("lib") || planSummary.includes("config") || planSummary.includes("depend"))

            if (!hasSubstance) {
              const reminder = `[SYSTEM: Your plan_summary was too brief (${planSummary.length} chars) to switch to BUILD mode. Investigate further — read the project manifest, explore the directory structure, and trace the relevant code. Call plan_exit again with a detailed summary.]`
              toolResultMessages.push({
                role: "user",
                content: [{ type: "text", text: reminder }],
              })
              console.log(`[engine] Plan verification FAILED — summary too brief. Staying in PLAN mode.`)
            } else {
              currentMode = "build"
              currentConfig = AGENT_CONFIG
              const buildTools = currentConfig.tools.map((t) => TOOL_REGISTRY[t.name]).filter(Boolean)
              const expertTool = TOOL_REGISTRY["expert_agent"]
              if (expertTool && (!options?.depth || options.depth < 1)) {
                availableTools = [...buildTools, expertTool]
              } else {
                availableTools = buildTools
              }
              const switchNote = `[SYSTEM: Mode switched from PLAN to BUILD. Here is the planning summary:\n\n${planSummary}\n\nYou now have full write/edit access. Continue with the implementation based on the investigation above.]`
              toolResultMessages.push({
                role: "user",
                content: [{ type: "text", text: switchNote }],
              })
              console.log(`[engine] Mode switched: plan → build`)
            }
          }
        }

        // Update consecutive errors based on round failure rate
        if (roundTotal > 0 && (roundFailed / roundTotal) > 0.5) {
          consecutiveErrors++
          console.log(`[engine] Round failure rate ${roundFailed}/${roundTotal} > 50%, consecutiveErrors=${consecutiveErrors}`)
        } else {
          consecutiveErrors = 0
        }

        // ── Circuit breaker: stop loop if generate_image failed ──────────
        // Image generation is expensive and retries waste tokens + UI state.
        const imageFailures = execResults.filter(
          (r): r is typeof r & { success: false; error?: string } =>
            r.tc.toolName === "generate_image" && !r.success && !r.skipResult
        )
        if (imageFailures.length > 0) {
          const errors = imageFailures.map((r) => r.error).filter(Boolean).join("; ")
          console.log(`[engine] Circuit breaker: generate_image failed. ${errors ? `Error: ${errors}` : ""}`)
          if (!finalText) {
            finalText = errors
              ? `Image generation failed: ${errors}`
              : "Image generation failed"
          }
          break
        }

        // ── Stop loop if image succeeded — image IS the answer ───────────
        const hadImageSuccess = execResults.some(
          (r) => r.tc.toolName === "generate_image" && r.success && !r.skipResult
        )
        if (hadImageSuccess) {
          console.log(`[engine] Image generated. Stopping — image is the answer.`)
          break
        }

        // ── 5. Trigger compaction if enough steps have passed ──────────────
        let compactedRange = await compactionService?.onStepComplete(stepNumber, provider, model)

        if (!compactedRange) {
          const postStepTokens = currentMessages.reduce((acc, m) => acc + estimateMessageTokens(m), 0)
          if (postStepTokens > 12000) {
            compactedRange = await compactionService?.onOverflow(stepNumber, provider, model)
          }
        }

        if (compactedRange) {
          const { stepRangeStart, stepRangeEnd } = compactedRange
          // Invalidate compaction cache so buildDynamicBlock re-reads from DB
          invalidateCompactionCache(messageId)
          // Rebuild the dynamic context block and update msg[0] in place
          const newBlock = buildDynamicBlock(messageId)
          const hasContextHeader = currentMessages.length > 0
            && currentMessages[0].role === "user"
            && typeof currentMessages[0].content === "string"
            && (currentMessages[0].content as string).startsWith("## Session Context")
          if (newBlock && hasContextHeader) {
            currentMessages[0] = { role: "user", content: newBlock }
          } else if (newBlock && !hasContextHeader) {
            currentMessages = [{ role: "user", content: newBlock }, ...currentMessages]
          } else if (!newBlock && hasContextHeader) {
            currentMessages = currentMessages.slice(1)
          }
          // Remove raw step messages that are now covered by the compaction summary
          const toRemove = new Set<{ role: string; content: unknown }>()
          for (let s = stepRangeStart; s <= stepRangeEnd; s++) {
            const msgs = stepMessages.get(s)
            if (msgs) {
              for (const msg of msgs) toRemove.add(msg)
              stepMessages.delete(s)
            }
          }
          if (toRemove.size > 0) {
            currentMessages = currentMessages.filter((m) => !toRemove.has(m))
            console.log(`[engine] Trimmed ${toRemove.size} messages for steps ${stepRangeStart}-${stepRangeEnd} after compaction, context now ${currentMessages.length} messages`)
          }
        }

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
          const input = tc.toolName === "write_file"
            ? { path: tc.args.path, bytes: typeof tc.args.content === "string" ? tc.args.content.length : 0 }
            : tc.args
          assistantContent.push({
            type: "tool-call",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input,
          })
        }

        // Track these messages so they can be removed by a future compaction
        const assistantMsg: { role: string; content: unknown } = { role: "assistant", content: assistantContent }
        const stepMsgList: Array<{ role: string; content: unknown }> = [assistantMsg]
        for (const tr of toolResultMessages) {
          stepMsgList.push(tr as { role: string; content: unknown })
        }
        stepMessages.set(stepNumber, stepMsgList)

        currentMessages = [
          ...currentMessages,
          assistantMsg,
          ...toolResultMessages,
        ]

        const cleared = clearOldToolOutputs(currentMessages, 2, currentMode)
        if (cleared > 0) {
          console.log(`[engine] Cleared ${cleared} old tool outputs to prevent context bloat`)
        }

        const totalTokens = currentMessages.reduce((acc, m) => acc + estimateMessageTokens(m), 0)
        console.log(`[engine] Step ${stepNumber} complete: ${step.toolCalls.length} tool calls, context now ${currentMessages.length} messages, ~${totalTokens} tokens`)
        flushBatch()
      }

      if (stepNumber >= MAX_STEPS && !finalText) {
        finalText = "I've reached the maximum number of steps for this request. Please try a simpler request or ask me to continue."
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
