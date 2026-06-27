import type { Message, AIProvider } from "@/types"
import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "./event-emitter"
import { buildSystemPrompt, buildRequest } from "./context-builder"
import { classifyTools } from "./tool-classifier"
import { classifyIntent } from "./intent-classifier"
import { AGENT_CONFIG, CAAT_CONFIG, PLAN_CONFIG } from "./modes"
import { TOOL_REGISTRY, type ToolImplementation } from "./tools"
import { ToolIsolationService } from "./tool-isolation-service"
import { CompactionService } from "./compaction-service"
import { createFileSnapshot } from "@/lib/db/adapter"
import type { DBFileSnapshot } from "@/lib/db/types"
import { executeEngineRun } from "./engine-runner"
import { WORKSPACE, generateId } from "./engine-utils"

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

  private async takeFileSnapshot(
    toolName: string,
    args: Record<string, unknown>,
    toolCallId: string,
    sessionId: string,
  ): Promise<void> {
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
      id: generateId(),
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
    options?: EngineRunOptions,
  ): Promise<string> {
    const mode = options?.mode ?? "standard"
    let currentMode: string = mode
    if (mode === "standard") {
      const lastUserMsg = messages.filter((m) => m.role === "user").pop()
      const intent = lastUserMsg ? classifyIntent(lastUserMsg.content) : "quick"
      currentMode = intent === "deep" ? "plan" : "standard"
    }
    const currentConfig =
      currentMode === "caat" ? CAAT_CONFIG : currentMode === "plan" ? PLAN_CONFIG : AGENT_CONFIG

    const basePrompt = buildSystemPrompt(currentMode as "standard" | "caat" | "plan", mcpTools, model)
    const fullSystemPrompt = skillInjected
      ? basePrompt + "\n\n" + skillInjected
      : basePrompt

    if (skillInjected) {
      console.log("Skill content injected, preview:", skillInjected.substring(0, 200))
    } else {
      console.log("No skills injected for this message")
    }

    let availableTools: ToolImplementation[] = currentConfig.tools
      .map((t) => TOOL_REGISTRY[t.name])
      .filter(Boolean) as ToolImplementation[]

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

    const built = buildRequest(messages, fullSystemPrompt, messageId)
    const requestSystemPrompt = built.system

    const strippedMessages = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : m.content,
    }))

    const finalText = await executeEngineRun(
      messages,
      messageId,
      provider,
      model,
      signal,
      options,
      currentMode,
      strippedMessages,
      availableTools,
      requestSystemPrompt,
      toolIsolation,
      compactionService,
      this.emitEvent.bind(this),
      this.takeFileSnapshot.bind(this),
    )

    console.log("Emitting message_complete event")
    this.emitEvent("message_complete", {})

    return finalText
  }
}
