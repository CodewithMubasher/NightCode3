import type { Message, AIProvider } from "@/types"
import { EventEmitter } from "./event-emitter"
import { MODE_CONFIGS, type ModeConfig } from "./modes"
import { buildSystemPrompt, buildContext } from "./context-builder"
import { plan, type PlannerOutput } from "./planner"
import { executeTool } from "./executor"
import { verifyToolResult } from "./verifier"
import { TOOL_REGISTRY, type ToolImplementation } from "./tools"

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
    mode: string,
    messageId: string,
    provider: AIProvider,
    model: string,
    signal: AbortSignal
  ): Promise<void> {
    const config: ModeConfig = MODE_CONFIGS[mode] ?? MODE_CONFIGS.chat

    const systemPrompt = buildSystemPrompt(mode, config)
    let context = buildContext(messages, systemPrompt)

    const availableTools: ToolImplementation[] = config.tools
      .map((t) => TOOL_REGISTRY[t.name])
      .filter(Boolean)

    let toolsExecuted = 0
    let consecutiveToolFailures = 0
    let forceRePlanCount = 0
    const toolsCalled = new Set<string>()
    const intent = config.intentDefault

    for (let iteration = 0; iteration < config.maxIterations; iteration++) {
      if (signal.aborted) return

      console.log(`=== ITERATION ${iteration} ===`)
      console.log("Messages being sent to LLM:")
      context.forEach((m) => console.log(`  [${m.role}] ${m.content.substring(0, 200)}`))

      let output: PlannerOutput

      try {
        output = await plan(context, provider, model, signal)
      } catch (err) {
        this.emitEvent("error", {
          message: `LLM call failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          iteration,
        })
        this.emitEvent("message_complete", {})
        return
      }

      console.log(`LLM output: action=${output.action}`, output.action === "tool_call" ? `tool=${output.tool}` : "")

      if (output.action === "tool_call") {
        const toolDef = availableTools.find((t) => t.name === output.tool)
        if (!toolDef) {
          this.emitEvent("error", {
            message: `Tool "${output.tool}" is not available in ${mode} mode`,
            iteration,
          })
          continue
        }

        this.emitEvent("tool_start", {
          tool: output.tool,
          args: output.args,
          iteration,
        })

        const execResult = await executeTool(toolDef, output.args)

        if (execResult.success) {
          const verification = await verifyToolResult(toolDef, output.args, execResult)

          if (verification.verified) {
            consecutiveToolFailures = 0
            toolsExecuted++
            toolsCalled.add(output.tool)
            this.emitEvent("tool_end", {
              tool: output.tool,
              args: output.args,
              status: "verified",
              result: execResult.data,
              evidence: verification.evidence,
              iteration,
            })

            if (output.tool === "create_artifact") {
              this.emitEvent("artifact", {
                artifact: {
                  id: generateId(),
                  title: (output.args.title as string) ?? "Untitled",
                  type: (output.args.type as "markdown" | "code" | "html" | "svg" | "mermaid") ?? "markdown",
                  content: (output.args.content as string) ?? "",
                },
              })
            }

            const toolResultMsg = `TOOL EXECUTED: ${output.tool}
ARGS: ${JSON.stringify(output.args)}
RESULT: SUCCESS (verified by runtime)
${JSON.stringify(execResult.data)}

The tool has completed. The file now exists on disk. You MUST now respond to the user with a final message. Do NOT call any more tools. Output {"action":"respond","content":"..."} IMMEDIATELY.`
            context.push({ role: "user", content: toolResultMsg })
            console.log(`[VERIFIED] Pushed tool result to context. toolsExecuted=${toolsExecuted + 1}`)
          } else {
            this.emitEvent("tool_end", {
              tool: output.tool,
              args: output.args,
              status: "verification_failed",
              discrepancy: verification.discrepancy,
              iteration,
            })
            context.push({
              role: "user",
              content: `TOOL EXECUTED: ${output.tool}
ARGS: ${JSON.stringify(output.args)}
RESULT: VERIFICATION FAILED
Discrepancy: ${verification.discrepancy}

You must address this discrepancy. Try a different approach or fix the issue.`,
            })
          }
        } else {
          consecutiveToolFailures++
          this.emitEvent("tool_end", {
            tool: output.tool,
            args: output.args,
            status: "error",
            error: execResult.error,
            iteration,
          })

          if (consecutiveToolFailures >= 3) {
            this.emitEvent("error", {
              message: `Tool "${output.tool}" failed 3 consecutive times. Terminating.`,
              lastError: execResult.error,
            })
            this.emitEvent("message_complete", {})
            return
          }

          context.push({
            role: "user",
            content: `TOOL EXECUTED: ${output.tool}
ARGS: ${JSON.stringify(output.args)}
RESULT: ERROR
${execResult.error}

Try a different approach to accomplish the task.`,
          })
        }
      } else if (output.action === "respond") {
        if (intent === "tool_required" && toolsExecuted === 0 && forceRePlanCount < 2) {
          forceRePlanCount++
          context.push({
            role: "user",
            content: `You responded without using any tools, but this mode requires tool usage. You MUST call one of these tools: ${availableTools.map(t => t.name).join(", ")}. Do not pretend to have done work. Actually call the necessary tool.`,
          })
          continue
        }

        const responseText = (output.content ?? "").toLowerCase()
        const claimedArtifactCreation =
          responseText.includes("artifact") &&
          (responseText.includes("created") || responseText.includes("in the"))
        if (mode === "plan" && claimedArtifactCreation && !toolsCalled.has("create_artifact") && forceRePlanCount < 1) {
          forceRePlanCount++
          context.push({
            role: "user",
            content: `You claimed to create an artifact but did not call create_artifact. You MUST call the create_artifact tool with the full content. Do not just say you created it — actually call the tool.`,
          })
          continue
        }

        this.emitEvent("thinking", { text: output.content, iteration })

          this.emitEvent("message_complete", {})
        return
      }
    }

    this.emitEvent("error", {
      message: `Reached maximum iterations (${config.maxIterations}) without completing the task.`,
    })
    this.emitEvent("message_complete", {})
  }
}
