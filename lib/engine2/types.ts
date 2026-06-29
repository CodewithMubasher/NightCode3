// ───────────────────────────────────────────────
// Port of opencode's LLMEvent, Part, Tool types
// translated from Effect.ts Schema → plain TS
// ───────────────────────────────────────────────

export type SessionID = string
export type MessageID = string
export type PartID = string
export type ToolCallID = string
export type ContentBlockID = string

export type FinishReason =
  | "stop"
  | "tool-calls"
  | "length"
  | "content-filtered"
  | "error"
  | "other"

// ─── Usage (tokens) ──────────────────────────────
export interface Usage {
  inputTokens?: number
  outputTokens?: number
  nonCachedInputTokens?: number
  cacheReadInputTokens?: number
  cacheWriteInputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  providerMetadata?: Record<string, unknown>
}

// ─── LLMEvent — Discriminated union ──────────────
export type LLMEvent =
  | StepStart
  | StepFinish
  | TextStart
  | TextDelta
  | TextEnd
  | ReasoningStart
  | ReasoningDelta
  | ReasoningEnd
  | ToolInputStart
  | ToolInputDelta
  | ToolInputEnd
  | ToolCall
  | ToolResult
  | ToolError
  | Finish
  | ProviderError

export const LLMEvent = {
  is: {
    stepStart: (e: LLMEvent): e is StepStart => e.type === "step-start",
    stepFinish: (e: LLMEvent): e is StepFinish => e.type === "step-finish",
    textStart: (e: LLMEvent): e is TextStart => e.type === "text-start",
    textDelta: (e: LLMEvent): e is TextDelta => e.type === "text-delta",
    textEnd: (e: LLMEvent): e is TextEnd => e.type === "text-end",
    reasoningStart: (e: LLMEvent): e is ReasoningStart => e.type === "reasoning-start",
    reasoningDelta: (e: LLMEvent): e is ReasoningDelta => e.type === "reasoning-delta",
    reasoningEnd: (e: LLMEvent): e is ReasoningEnd => e.type === "reasoning-end",
    toolInputStart: (e: LLMEvent): e is ToolInputStart => e.type === "tool-input-start",
    toolInputDelta: (e: LLMEvent): e is ToolInputDelta => e.type === "tool-input-delta",
    toolInputEnd: (e: LLMEvent): e is ToolInputEnd => e.type === "tool-input-end",
    toolCall: (e: LLMEvent): e is ToolCall => e.type === "tool-call",
    toolResult: (e: LLMEvent): e is ToolResult => e.type === "tool-result",
    toolError: (e: LLMEvent): e is ToolError => e.type === "tool-error",
    finish: (e: LLMEvent): e is Finish => e.type === "finish",
    providerError: (e: LLMEvent): e is ProviderError => e.type === "provider-error",
  },
}

export interface StepStart {
  type: "step-start"
  index: number
}

export interface StepFinish {
  type: "step-finish"
  index: number
  reason: FinishReason
  usage?: Usage
  providerMetadata?: Record<string, unknown>
}

export interface TextStart {
  type: "text-start"
  id: ContentBlockID
  providerMetadata?: Record<string, unknown>
}

export interface TextDelta {
  type: "text-delta"
  id: ContentBlockID
  text: string
  providerMetadata?: Record<string, unknown>
}

export interface TextEnd {
  type: "text-end"
  id: ContentBlockID
  providerMetadata?: Record<string, unknown>
}

export interface ReasoningStart {
  type: "reasoning-start"
  id: ContentBlockID
  providerMetadata?: Record<string, unknown>
}

export interface ReasoningDelta {
  type: "reasoning-delta"
  id: ContentBlockID
  text: string
  providerMetadata?: Record<string, unknown>
}

export interface ReasoningEnd {
  type: "reasoning-end"
  id: ContentBlockID
  providerMetadata?: Record<string, unknown>
}

export interface ToolInputStart {
  type: "tool-input-start"
  id: ToolCallID
  name: string
  providerMetadata?: Record<string, unknown>
}

export interface ToolInputDelta {
  type: "tool-input-delta"
  id: ToolCallID
  name: string
  text: string
}

export interface ToolInputEnd {
  type: "tool-input-end"
  id: ToolCallID
  name: string
  providerMetadata?: Record<string, unknown>
}

export interface ToolCall {
  type: "tool-call"
  id: ToolCallID
  name: string
  input: unknown
  providerExecuted?: boolean
  providerMetadata?: Record<string, unknown>
}

export interface ToolResult {
  type: "tool-result"
  id: ToolCallID
  name: string
  result: ToolResultValue
  output?: ToolOutput
  providerExecuted?: boolean
  providerMetadata?: Record<string, unknown>
}

export interface ToolError {
  type: "tool-error"
  id: ToolCallID
  name: string
  message: string
  error?: unknown
  providerMetadata?: Record<string, unknown>
}

export interface Finish {
  type: "finish"
  reason: FinishReason
  usage?: Usage
  providerMetadata?: Record<string, unknown>
}

export interface ProviderError {
  type: "provider-error"
  message: string
  retryable?: boolean
  providerMetadata?: Record<string, unknown>
}

// ─── Tool Result Value ───────────────────────────
export type ToolResultValue =
  | { type: "json"; value: unknown }
  | { type: "text"; value: unknown }
  | { type: "error"; value: unknown }
  | { type: "content"; value: ToolContent[] }

export function makeToolResultValue(
  value: unknown,
  resultType: ToolResultValue["type"] = "json"
): ToolResultValue {
  if (isToolResultValue(value)) return value
  if (resultType === "content") return { type: "content", value: Array.isArray(value) ? value : [] }
  return { type: resultType, value }
}

export function isToolResultValue(value: unknown): value is ToolResultValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "value" in value &&
    (value as any).type !== undefined
  )
}

// ─── Tool Content (for model output) ─────────────
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "file"; uri: string; mime: string; name?: string }

// ─── Tool Output (structured + display) ──────────
export interface ToolOutput {
  structured: unknown
  content: ToolContent[]
}

export const ToolOutput = {
  make: (structured: unknown, content: ToolContent[] = []): ToolOutput => ({
    structured,
    content,
  }),
  fromResultValue: (result: ToolResultValue): ToolOutput | undefined => {
    switch (result.type) {
      case "json":
        return { structured: result.value, content: [] }
      case "text":
        return { structured: {}, content: [{ type: "text", text: toolResultText(result.value) }] }
      case "content":
        return { structured: {}, content: result.value }
      case "error":
        return undefined
    }
  },
  toResultValue: (output: ToolOutput): ToolResultValue => {
    if (output.content.length === 0) return { type: "json", value: output.structured }
    if (output.content.length === 1 && output.content[0]?.type === "text")
      return { type: "text", value: output.content[0].text }
    return { type: "content", value: output.content }
  },
}

function toolResultText(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// ─── Parts ───────────────────────────────────────
// Message content is an array of independent parts.
// Each part renders independently — text is ALWAYS
// visible regardless of tool state (matching opencode).

export interface ImagePart {
  type: "image"
  id: PartID
  image: string
  mimeType: string
  metadata?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}

export interface TextPart {
  type: "text"
  id: PartID
  text: string
  metadata?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}

export interface ToolCallPart {
  type: "tool-call"
  id: PartID
  toolCallId: ToolCallID
  name: string
  input: unknown
  providerExecuted?: boolean
  metadata?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}

export interface ToolResultPart {
  type: "tool-result"
  id: PartID
  toolCallId: ToolCallID
  name: string
  result: ToolResultValue
  providerExecuted?: boolean
  metadata?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}

export interface ReasoningPart {
  type: "reasoning"
  id: PartID
  text: string
  metadata?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}

export type Part = TextPart | ImagePart | ToolCallPart | ToolResultPart | ReasoningPart

// ─── Session Message ─────────────────────────────
export interface SessionMessage {
  role: "user" | "assistant" | "tool" | "system"
  id?: MessageID
  parts: Part[]
  metadata?: Record<string, unknown>
}

// ─── Tool System ─────────────────────────────────
export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (params: unknown, context?: ToolExecuteContext) => Promise<ToolExecuteResult>
  toModelOutput?: (input: ToolModelOutputInput) => ToolContent[]
}

export interface ToolExecuteContext {
  id: ToolCallID
  name: string
}

export interface ToolExecuteResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface ToolModelOutputInput {
  callID: string
  parameters: unknown
  output: unknown
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type Tools = Record<string, ToolDef>

export function toToolDefinitions(tools: Tools): ToolDefinition[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

// ─── Tool Result formatting ──────────────────────
export type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "json"; value: unknown }

// ─── Session Event (for UI consumption) ──────────
export type SessionEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-start"; tool: string; args: unknown; toolCallId: string }
  | { type: "tool-end"; tool: string; args: unknown; status: string; result?: unknown; error?: string; toolCallId: string }
  | { type: "error"; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; reasoningTokens: number }
  | { type: "ask"; questions: unknown }
  | { type: "permission"; tool: string; args: unknown; reason: string; toolCallId: string }
  | { type: "confirmation"; path: string; fileCount: number; toolCallId: string }
  | { type: "artifact"; artifact: unknown }
  | { type: "done"; text: string }

// ─── ID generation ───────────────────────────────
let contentBlockCounter = 0
let toolCallIdCounter = 0

export function createContentBlockId(): ContentBlockID {
  return `cb_${Date.now().toString(36)}_${++contentBlockCounter}`
}

export function createToolCallId(): ToolCallID {
  return `tc_${Date.now().toString(36)}_${++toolCallIdCounter}`
}

// ─── LLM Response (helper) ───────────────────────
export class LLMResponse {
  constructor(
    readonly events: LLMEvent[],
    readonly usage?: Usage,
  ) {}

  get text(): string {
    return this.events
      .filter((e): e is TextDelta => e.type === "text-delta")
      .map((e) => e.text)
      .join("")
  }

  get reasoning(): string {
    return this.events
      .filter((e): e is ReasoningDelta => e.type === "reasoning-delta")
      .map((e) => e.text)
      .join("")
  }

  get toolCalls(): ToolCall[] {
    return this.events.filter((e): e is ToolCall => e.type === "tool-call")
  }
}

// ─── Provider message format (for LLM context) ───
// Converted from SessionMessage[] before sending to providers.
// Matches the standard OpenAI / Anthropic multi-part message format.
export interface ProviderTextContent {
  type: "text"
  text: string
}

export interface ProviderToolCallContent {
  type: "tool-call"
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ProviderToolResultContent {
  type: "tool-result"
  toolCallId: string
  toolName: string
  output: ToolResultContent
}

export interface ProviderImageContent {
  type: "image"
  image: string
  mimeType: string
}

export type ProviderContent =
  | ProviderTextContent
  | ProviderImageContent
  | ProviderToolCallContent
  | ProviderToolResultContent

export interface ProviderMessage {
  role: "user" | "assistant" | "tool" | "system"
  content: ProviderContent[]
}

export type ProviderStreamFn = (
  messages: ProviderMessage[],
  system?: string,
  tools?: ToolDefinition[],
  callbacks?: { onText?: (text: string) => void; onReasoning?: (text: string) => void },
  signal?: AbortSignal,
) => Promise<{
  text: string
  reasoning: string
  toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> | null }>
  finishReason?: string
  usage?: Usage
}>
