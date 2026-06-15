import type { Message, AIProvider } from "@/types"
import { EventEmitter } from "./event-emitter"
import { AGENT_CONFIG, type ModeConfig } from "./modes"
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
    messageId: string,
    provider: AIProvider,
    model: string,
    signal: AbortSignal,
    skillInjected?: string,
    mcpTools?: ToolImplementation[]
  ): Promise<void> {
    const config: ModeConfig = AGENT_CONFIG

    const basePrompt = buildSystemPrompt(mcpTools)
    const fullSystemPrompt = skillInjected
      ? basePrompt + '\n\n' + skillInjected
      : basePrompt
    if (skillInjected) {
      console.log('Skill content injected, preview:', skillInjected.substring(0, 200))
    } else {
      console.log('No skills injected for this message')
    }
    let context = buildContext(messages, fullSystemPrompt)

    let availableTools: ToolImplementation[] = config.tools
      .map((t) => TOOL_REGISTRY[t.name])
      .filter(Boolean)

    if (mcpTools) {
      availableTools = [...availableTools, ...mcpTools]
    }

    let consecutiveToolFailures = 0

    for (let iteration = 0; iteration < config.maxIterations; iteration++) {
      if (signal.aborted) return

      console.log(`=== ITERATION ${iteration} ===`)
      console.log("Messages being sent to LLM (counts: sys=" + context.filter(m => m.role === "system").length + ", user=" + context.filter(m => m.role === "user").length + "):")
      context.forEach((m) => console.log(`  [${m.role}] (${m.content.length} chars) ${m.content.substring(0, 300)}`))

      let output: PlannerOutput

      try {
        output = await plan(context, provider, model, signal)
      } catch (err) {
        this.emitEvent("error", {
          message: `LLM call failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          iteration,
        })
        console.log('Emitting message_complete event')
        this.emitEvent("message_complete", {})
        return
      }

      console.log(`LLM output: action=${output.action}`, output.action === "tool_call" ? `tool=${output.tool}` : "")

      if (output.action === "tool_call") {
        const normalize = (name: string) => name.replace(/-/g, "_").toLowerCase()
        const toolDef = availableTools.find((t) => normalize(t.name) === normalize(output.tool))
        if (!toolDef) {
          const allToolNames = availableTools.map((t) => t.name)
          this.emitEvent("error", {
            message: `Tool "${output.tool}" is not available`,
            iteration,
          })
          context.push({
            role: "user",
            content: `Tool "${output.tool}" not found. Available tools: ${allToolNames.join(", ")}. Try a different tool or respond with text.`,
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

The tool has completed. Continue reasoning and call more tools if needed, or respond to the user when done.`
            context.push({ role: "user", content: toolResultMsg })
            console.log(`[VERIFIED] Pushed tool result to context`)
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
            console.log('Emitting message_complete event')
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
        this.emitEvent("thinking", { text: output.content, iteration })

          console.log('Emitting message_complete event')
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
