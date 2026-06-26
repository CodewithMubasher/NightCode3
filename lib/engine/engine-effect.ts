import { Effect, Layer, ManagedRuntime } from "effect"
import type { Message, AIProvider } from "@/types"
import { EventEmitter } from "./event-emitter"
import {
  NightCodeEngine,
  ProviderError,
  ToolExecutionError,
  ModeTransitionError,
  SessionService,
  ProviderRegistry,
  ToolRegistry,
  Logger,
  LoggerLive,
  Mode,
  canTransition,
  createInitialModeContext,
  transitionTo,
  verifyPlanGate,
  runSafe,
} from "./nightcode-effect"
import { SessionServiceLive } from "./session"
import { ProviderRegistryLive } from "./provider-registry"
import { ToolRegistryLive } from "./tool-registry"
import { PLAN_CONFIG, AGENT_CONFIG, CAAT_CONFIG, type ModeConfig } from "./modes"
import { buildSystemPrompt } from "./context-builder"
import { planStep } from "./planner"
import { executeTool } from "./executor"
import { verifyToolResult } from "./verifier"
import { TOOL_REGISTRY, type ToolImplementation } from "./tools"
import { ToolIsolationService } from "./tool-isolation-service"
import { CompactionService } from "./compaction-service"
import { classifyIntent } from "./intent-classifier"
import { Semaphore } from "./semaphore"
import { classifyTools } from "./tool-classifier"
import { needsPermission, rememberPermission } from "./permission"
import { createStep, createFileSnapshot } from "@/lib/db/adapter"
import type { DBFileSnapshot } from "@/lib/db/types"
import { boundToolOutput } from "./tool-output-store"
import { DoomLoopTracker } from "./doom-loop-tracker"
import * as fs from "fs"
import * as path from "path"

const WORKSPACE = process.cwd()

// ─── Effect Runtime ├──────────────────────────────────────────────────────
const EngineLayer = Layer.mergeAll(
  LoggerLive,
  SessionServiceLive,
  ProviderRegistryLive,
  ToolRegistryLive,
)

const runtime = ManagedRuntime.make(EngineLayer)

export interface EngineRunOptions {
  mode?: Mode
  silent?: boolean
}

export class NightCodeEngineEffect {
  private emitter = new EventEmitter()
  private engineVersion = "2.0-effect"

  subscribe(fn: (event: string, data: unknown) => void): () => void {
    return this.emitter.subscribe(fn)
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    this.emitter.emit("engine_event", { type, payload, timestamp: Date.now() })
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

    // Use Effect for the core orchestration
    return runSafe(
      Effect.gen(this, function* (_gen) {
        const logger = yield* _(Logger)
        yield* _(logger.info("Engine run started", { provider: provider.id, model, mode }))

        // 1. Classify intent (if standard mode)
        let currentMode: Mode = mode as Mode
        if (mode === "standard") {
          const lastUserMsg = messages.filter((m) => m.role === "user").pop()
          const intent = lastUserMsg ? classifyIntent(lastUserMsg.content) : "quick"
          currentMode = intent === "deep" ? "plan" : "standard"
        }

        // 2. Create mode context
        let modeCtx = createInitialModeContext(currentMode)
        let currentConfig: ModeConfig =
          currentMode === "caat" ? CAAT_CONFIG : currentMode === "plan" ? PLAN_CONFIG : AGENT_CONFIG

        // 3. Get provider info
        const providerRegistry = yield* _(ProviderRegistry)
        const providerPlugin = yield* _(providerRegistry.get(provider.id))

        // 4. Build system prompt
        const basePrompt = buildSystemPrompt(currentMode, mcpTools, model)
        const fullSystemPrompt = skillInjected ? `${basePrompt}\n\n${skillInjected}` : basePrompt

        // 5. Build tool config
        let availableTools = currentMode === "caat" ? currentConfig.tools : mcpTools?.length ? mcpTools : [...TOOL_REGISTRY.values()]
        if (currentConfig.tools?.length) {
          const toolNames = new Set(currentConfig.tools)
          availableTools = (mcpTools?.length ? mcpTools : [...TOOL_REGISTRY.values()]).filter(
            (t) => toolNames.has(t.name),
          )
        }

        // 6. Delegate to the existing synced engine runtime
        const result = yield* _(Effect.async<string>((resume) => {
          const engine = new NightCodeEngine()

          // Forward events
          const unsub = engine.subscribe((event, data) => {
            this.emitter.emit(event, data)
          })

          engine
            .run(messages, messageId, provider, model, signal, skillInjected, mcpTools, toolIsolation, compactionService, {
              mode: currentMode,
              silent: options?.silent,
            })
            .then((text) => {
              unsub()
              resume(Effect.succeed(text))
            })
            .catch((err) => {
              unsub()
              resume(Effect.fail(err instanceof Error ? new ProviderError(provider.id, 0, err.message) : new ProviderError(provider.id, 0, String(err))))
            })
        }))

        yield* _(logger.info("Engine run completed"))
        return result
      }),
    )
  }
}
