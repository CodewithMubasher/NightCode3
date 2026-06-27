import type { AIProvider } from "@/types"
import * as fs from "fs"
import * as path from "path"
import { AGENT_CONFIG, CAAT_CONFIG, PLAN_CONFIG, type ModeConfig } from "./modes"
import { buildRequest, buildDynamicBlock, invalidateCompactionCache } from "./context-builder"
import { planStep } from "./planner"
import { flushBatch } from "@/lib/db/batch"
import { executeTool } from "./executor"
import { verifyToolResult } from "./verifier"
import type { VerificationResult, ToolImplementation } from "./tools"
import { invalidateListingCache } from "./tools/list-directory"
import { TOOL_REGISTRY } from "./tools"
import { ToolIsolationService } from "./tool-isolation-service"
import { CompactionService } from "./compaction-service"
import { Semaphore } from "./semaphore"
import { createStep, updateSessionMetadata } from "@/lib/db/adapter"
import { boundToolOutput } from "./tool-output-store"
import { DoomLoopTracker } from "./doom-loop-tracker"
import { needsPermission } from "./permission"
import {
  generateId,
  estimateMessageTokens,
  clearOldToolOutputs,
  countFilesRecursive,
  WORKSPACE,
  startStepTimer,
  elapsedMs,
  normalizeToolName,
  toolAliases,
} from "./engine-utils"
import type { EngineRunOptions } from "./index"

export async function executeEngineRun(
  messages: import("@/types").Message[],
  messageId: string,
  provider: AIProvider,
  model: string,
  signal: AbortSignal,
  options: EngineRunOptions | undefined,
  currentMode: string,
  currentMessages: Array<{ role: string; content: unknown }>,
  availableTools: ToolImplementation[],
  requestSystemPrompt: string,
  toolIsolation: ToolIsolationService | undefined,
  compactionService: CompactionService | undefined,
  emitEvent: (type: string, payload: Record<string, unknown>) => void,
  takeFileSnapshot: (toolName: string, args: Record<string, unknown>, toolCallId: string, sessionId: string) => Promise<void>,
): Promise<string> {
  let currentConfig: ModeConfig = currentMode === "caat" ? CAAT_CONFIG : currentMode === "plan" ? PLAN_CONFIG : AGENT_CONFIG
  const MAX_STEPS = currentConfig.maxIterations

  let stepNumber = 0
  let toolCallCount = 0
  let finalText = ""
  let consecutiveErrors = 0
  let malformedCount = 0
  let cumulativeInputTokens = 0
  let cumulativeOutputTokens = 0
  let cumulativeReasoningTokens = 0
  let totalDurationMs = 0

  const stepMessages = new Map<number, Array<{ role: string; content: unknown }>>()

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

  const toolSem = new Semaphore(5)

  try {
    while (stepNumber < MAX_STEPS) {
      if (signal.aborted) break

      stepNumber++
      const stepId = `step_${stepNumber}_${generateId().slice(0, 8)}`
      console.log(`[engine] Step ${stepNumber}/${MAX_STEPS} starting`)

      toolIsolation?.setStepId(stepId)

      const preCallTokens = currentMessages.reduce((acc, m) => acc + estimateMessageTokens(m), 0)
      if (preCallTokens > 8000) {
        const before = currentMessages.length
        const cleared = clearOldToolOutputs(currentMessages, 1, currentMode)
        if (cleared > 0) {
          console.log(`[engine] Pre-call overflow prevention: cleared ${cleared} old tool outputs (${before} msgs)`)
        }
      }

      const stepStartTime = startStepTimer()

      if (currentMode === "plan" && stepNumber > 1) {
        const summary = investigation.getSummary()
        if (summary) {
          currentMessages.push({
            role: "user",
            content: `[Investigation Status]\n${summary}\nDo NOT re-read these files. Continue investigating unexplored areas.`,
          })
        }
      }

      let step: Awaited<ReturnType<typeof planStep>> | null = null
      try {
        step = await planStep(
          currentMessages,
          provider,
          model,
          availableTools,
          {
            onText: (text) => {
              emitEvent("text_delta", { text })
            },
          },
          signal,
          requestSystemPrompt
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        console.error(`[engine] planStep failed at step ${stepNumber}: ${msg}`)
        emitEvent("error", { message: `LLM call failed: ${msg}. Continuing.` })
        currentMessages.push({
          role: "user",
          content: `[SYSTEM: The previous LLM call failed with: ${msg}. Please respond with a simpler approach, or summarize what was done so far.]`,
        })
        continue
      }

      if (step.usage) {
        const stepDurationMs = elapsedMs(stepStartTime)
        totalDurationMs += stepDurationMs
        const outputTokensPerSec = stepDurationMs > 0
          ? Math.round((step.usage.outputTokens / stepDurationMs) * 1000)
          : 0
        cumulativeInputTokens += step.usage.inputTokens
        cumulativeOutputTokens += step.usage.outputTokens
        cumulativeReasoningTokens += (step.usage.reasoningTokens ?? 0)
        emitEvent("usage", {
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

      if (step.type === "text") {
        finalText = step.content
        console.log(`[engine] Done. ${toolCallCount} total tool calls across ${stepNumber} steps. Final text length: ${finalText.length}`)
        compactionService?.onStepComplete(stepNumber, provider, model)
        break
      }

      const toolResultMessages: Array<{ role: string; content: Array<Record<string, unknown>> }> = []
      let asked = false
      let roundFailed = 0
      let roundTotal = 0

      const doomLoopTracker = new DoomLoopTracker()

      const calls = step.toolCalls.map((tc) => {
        toolCallCount++
        const resolvedName = toolAliases[tc.toolName] ?? tc.toolName
        const toolDef = availableTools.find((t) => normalizeToolName(t.name) === normalizeToolName(resolvedName))
        const generatedId = toolIsolation?.registerToolCall(tc.toolName, tc.args, toolCallCount) ?? `tool_${toolCallCount}_${generateId().slice(0, 8)}`
        let args = tc.args
        if (args === null || args === undefined) {
          const msg = `Malformed tool call: ${tc.toolName} received invalid arguments. The model produced broken JSON.`
          emitEvent("error", { message: msg })
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
          return { ...tc, toolDef: undefined, generatedId, args: null as null, resolvedName, malformed: true } as const
        }
        if (resolvedName === "expert_agent") {
          args = { ...args, __emitEvent: emitEvent, __abortSignal: signal }
        }
        doomLoopTracker.record(tc.toolName, tc.args)
        return { ...tc, toolDef, generatedId, args, resolvedName, malformed: false } as const
      })

      for (const tc of calls) {
        if (tc.toolDef || tc.malformed) continue
        const msg = `Tool "${tc.toolName}" not found. Available: ${availableTools.map((t) => t.name).join(", ")}`
        emitEvent("error", { message: msg })
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

      const validCalls = calls.filter((tc): tc is typeof tc & { args: Record<string, unknown>; toolName: string; toolCallId: string } => tc.toolDef !== undefined && !tc.malformed && tc.args !== null)
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
        emitEvent("tool_start", { tool: tc.toolName, args: tc.args, callNumber: toolCallCount, toolCallId: tc.generatedId })
      }

      const execResults = await Promise.all(
        validCalls.map((tc) => toolSem.run(async () => {
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
              emitEvent("ask", { questions })
            } catch {
              emitEvent("ask", { questions: [] })
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
            } catch (e) { console.error("[engine] Failed to count files for confirmation:", e) }
            emitEvent("confirmation", { path: tc.args.path, fileCount, toolCallId: tc.generatedId })
            return { tc, skipResult: true } as const
          }

          if (consecutiveErrors >= 3) {
            // After 3 consecutive failing rounds, refuse to keep retrying the same
            // approach. The loop will break on the shouldStopForErrors check below.
            return {
              tc,
              success: false,
              error: `Aborted: ${consecutiveErrors} consecutive failed rounds. Stop retrying and summarize the problem for the user.`,
              skipResult: false,
              forcedThink: false,
            } as const
          }

          if (consecutiveErrors >= 1) {
            const forcedThink = {
              success: true,
              data: {
                thought: `The last ${consecutiveErrors} tool call round(s) failed. Reassess what went wrong, try a different approach, or fall back to write_file before retrying.`,
              },
            }
            return { tc, skipResult: false, success: true, data: forcedThink.data, forcedThink: true } as const
          }

          const permRequest = needsPermission(tc.toolName, tc.args)
          if (permRequest) {
            emitEvent("permission", { tool: tc.toolName, args: tc.args, reason: permRequest.reason, toolCallId: tc.generatedId })
            return { tc, skipResult: true } as const
          }

          if (!options?.silent && ["write_file", "create_folder"].includes(tc.resolvedName)) {
            await takeFileSnapshot(tc.resolvedName, tc.args, tc.generatedId, messageId)
          }

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
          emitEvent("tool_end", {
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
          // Invalidate directory listing cache after file mutations
          const fileArg = tc.args.path as string | undefined
          if (fileArg && ["write_file", "create_folder", "delete_file", "edit_file"].includes(tc.toolName)) {
            const dir = path.dirname(path.isAbsolute(fileArg) ? fileArg : path.resolve(WORKSPACE, fileArg))
            invalidateListingCache(dir)
            invalidateListingCache(WORKSPACE) // root listing may change too
          }

          if (tc.toolName === "create_artifact") {
            const { addArtifact } = await import("@/lib/engine/artifact-store")
            const artifact = {
              id: generateId(),
              title: (tc.args.title as string) ?? "Untitled",
              type: (tc.args.type as "markdown" | "code" | "html" | "svg" | "mermaid") ?? "markdown",
              content: (tc.args.content as string) ?? "",
            }
            addArtifact(artifact)
            emitEvent("artifact", { artifact })
          }

          if (tc.toolName === "edit_artifact") {
            const { getArtifact } = await import("@/lib/engine/artifact-store")
            const updated = getArtifact(tc.args.id as string)
            if (updated) {
              emitEvent("artifact", { artifact: updated })
            }
          }

          emitEvent("tool_end", {
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
          emitEvent("tool_end", {
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

      if (currentMode === "plan") {
        const planExitResult = execResults.find(
          (r) => r.tc.toolName === "plan_exit" && r.success && r.data?._switchMode === "build"
        )
        if (planExitResult) {
          const planSummary = planExitResult.data.planSummary ?? ""
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

      if (roundTotal > 0 && (roundFailed / roundTotal) > 0.5) {
        consecutiveErrors++
        console.log(`[engine] Round failure rate ${roundFailed}/${roundTotal} > 50%, consecutiveErrors=${consecutiveErrors}`)
      } else {
        consecutiveErrors = 0
      }

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
      let compactedRange = await compactionService?.onStepComplete(stepNumber, provider, model)

      if (!compactedRange) {
        const postStepTokens = currentMessages.reduce((acc, m) => acc + estimateMessageTokens(m), 0)
        if (postStepTokens > 12000) {
          compactedRange = await compactionService?.onOverflow(stepNumber, provider, model)
        }
      }

      if (compactedRange) {
        const { stepRangeStart, stepRangeEnd } = compactedRange
        invalidateCompactionCache(messageId)
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

      flushBatch()
      if (asked) break

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

      // ── Terminal conditions checked AFTER context is appended so parallel
      // tool results (e.g. write_file alongside generate_image) are preserved.
      const hadImageSuccess = execResults.some(
        (r) => r.tc.toolName === "generate_image" && r.success && !r.skipResult
      )
      if (hadImageSuccess) {
        console.log(`[engine] Image generated. Stopping — image is the answer.`)
        break
      }

      if (consecutiveErrors >= 3) {
        console.log(`[engine] Aborting: ${consecutiveErrors} consecutive failed rounds.`)
        if (!finalText) {
          finalText = "I hit repeated errors while working on this task. Here's what I was able to determine; please rephrase or provide more detail and I'll try a different approach."
        }
        break
      }

      try {
        updateSessionMetadata(messageId, {
          assistantText: finalText,
          stepNumber,
          toolCallCount,
          lastEventType: "tool_calls",
          updatedAt: Date.now(),
        })
      } catch (e: any) { console.error("[engine] Failed to update session metadata:", e.message) }

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
    emitEvent("error", {
      message: `Engine error: ${err instanceof Error ? err.message : "Unknown error"}`,
    })
    return `Engine error: ${err instanceof Error ? err.message : "Unknown error"}`
  }
}
