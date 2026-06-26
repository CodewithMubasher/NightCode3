import { Effect, Layer, Context, Scope, Console, Ref } from "effect"

// ─── Tagged Error Types ───────────────────────────────────────────────────
export class ProviderError {
  readonly _tag = "ProviderError"
  constructor(
    readonly provider: string,
    readonly statusCode: number,
    readonly message: string,
  ) {}
}

export class ToolExecutionError {
  readonly _tag = "ToolExecutionError"
  constructor(
    readonly toolName: string,
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

export class ValidationError {
  readonly _tag = "ValidationError"
  constructor(readonly message: string) {}
}

export class ModeTransitionError {
  readonly _tag = "ModeTransitionError"
  constructor(readonly from: string, readonly to: string, readonly message: string) {}
}

// ─── Tool Definition (typed, validated) ───────────────────────────────────
export interface ToolDef<A extends Record<string, unknown> = Record<string, unknown>, R = unknown> {
  name: string
  description: string
  schema: Record<string, string | Record<string, unknown>>
  execute: (args: A) => Effect.Effect<{ success: boolean; data: unknown; error?: string }, ToolExecutionError, R>
  validate?: (args: unknown) => args is A
}

// ─── Provider Plugin ──────────────────────────────────────────────────────
export interface ProviderPlugin {
  id: string
  displayName: string
  supportsToolCalling: boolean
  baseUrl: string | ((model: string) => string)
  headers: (apiKey: string) => Record<string, string>
  rpm: number
  parseResponse: (raw: unknown) => Effect.Effect<ProviderResponse, ProviderError>
}

export interface ProviderResponse {
  text: string
  toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>
  usage?: { inputTokens: number; outputTokens: number; reasoningTokens?: number }
}

// ─── Session (durable state) ──────────────────────────────────────────────
export interface SessionState {
  id: string
  messages: SessionMessage[]
  mode: Mode
  investigation: InvestigationState
  createdAt: number
  updatedAt: number
}

export type SessionMessage =
  | { role: "user"; content: string; id: string; timestamp: number }
  | { role: "assistant"; content: string; id: string; timestamp: number }
  | { role: "tool"; content: ToolResultMessage; id: string; timestamp: number }

export interface ToolResultMessage {
  toolCallId: string
  toolName: string
  output: unknown
}

export interface InvestigationState {
  visitedFiles: string[]
  visitedDirs: string[]
  discoveredFacts: string[]
}

// ─── Mode State Machine ──────────────────────────────────────────────────
export type Mode = "standard" | "plan" | "build" | "caat"

export const VALID_TRANSITIONS: Record<Mode, Mode[]> = {
  standard: ["plan", "caat"],
  plan: ["build", "standard"],
  build: ["standard", "plan"],
  caat: ["standard"],
}

export function canTransition(from: Mode, to: Mode): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ─── Service Tags (Effect-TS Services) ────────────────────────────────────
export class SessionService extends Context.Tag("SessionService")<
  SessionService,
  {
    get: (id: string) => Effect.Effect<SessionState>
    save: (state: SessionState) => Effect.Effect<void>
    appendMessage: (sessionId: string, msg: SessionMessage) => Effect.Effect<SessionState>
    updateMode: (sessionId: string, mode: Mode) => Effect.Effect<SessionState>
    getInvestigation: (sessionId: string) => Effect.Effect<InvestigationState>
    updateInvestigation: (sessionId: string, update: Partial<InvestigationState>) => Effect.Effect<InvestigationState>
  }
>() {}

export class ProviderRegistry extends Context.Tag("ProviderRegistry")<
  ProviderRegistry,
  {
    register: (plugin: ProviderPlugin) => Effect.Effect<void>
    get: (id: string) => Effect.Effect<ProviderPlugin>
    list: () => Effect.Effect<ProviderPlugin[]>
    supportsToolCalling: (id: string) => Effect.Effect<boolean>
  }
>() {}

export class ToolRegistry extends Context.Tag("ToolRegistry")<
  ToolRegistry,
  {
    register: (tool: ToolDef) => Effect.Effect<void>
    get: (name: string) => Effect.Effect<ToolDef>
    list: () => Effect.Effect<ToolDef[]>
    execute: (name: string, args: Record<string, unknown>) => Effect.Effect<{ success: boolean; data: unknown; error?: string }, ToolExecutionError>
  }
>() {}

// ─── Logger Service ───────────────────────────────────────────────────────
export class Logger extends Context.Tag("Logger")<
  Logger,
  {
    info: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void>
    warn: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void>
    error: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void>
    debug: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void>
  }
>() {}

// ─── Default Logger Implementation ────────────────────────────────────────
export const LoggerLive = Layer.succeed(Logger, {
  info: (msg, meta) => Console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg, meta) => Console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg, meta) => Console.error(`[error] ${msg}`, meta ?? ""),
  debug: (msg, meta) => Console.debug(`[debug] ${msg}`, meta ?? ""),
})

// ─── Scope-based Resource Management ──────────────────────────────────────
export function makeScopedResource<T>(
  name: string,
  acquire: Effect.Effect<T>,
  release: (resource: T) => Effect.Effect<void>,
): Effect.Effect<T, never, Scope.Scope> {
  return Scope.extend(
    Effect.acquireRelease(acquire, (resource, exit) =>
      Effect.orDie(
        Effect.andThen(
          Logger.info(`Releasing resource: ${name}`),
          () => release(resource),
          () => Logger.info(`Released resource: ${name}`),
        ),
      ),
    ),
  )
}

// ─── Sync wrapper for Effect pipelines ────────────────────────────────────
export function runSafe<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(
    Effect.catchAll(effect, (e) => {
      Console.error("Unhandled error in Effect pipeline", e)
      return Effect.die(e as unknown)
    }),
  )
}
