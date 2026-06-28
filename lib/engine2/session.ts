// ───────────────────────────────────────────────
// Port of opencode's SessionProcessor
// Event-driven session that stores Parts per turn
// ───────────────────────────────────────────────

import {
  type LLMEvent,
  type Part,
  type TextPart,
  type ToolCallPart,
  type ToolResultPart,
  type ReasoningPart,
  type ToolCallID,
  type ContentBlockID,
  type SessionMessage,
  type ProviderMessage,
  type ProviderContent,
  type SessionEvent,
  type Usage,
  type FinishReason,
  type PartID,
  type ToolDef,
  type ToolExecuteResult,
  type ToolResultValue,
  type ToolResultContent,
} from "./types"

export type SessionStatus = "running" | "tools-pending" | "tools-executing" | "finished" | "error"

export interface SessionCallbacks {
  onEvent: (event: SessionEvent) => void
  onPartAdded?: (part: Part) => void
  onPartUpdated?: (part: Part) => void
  onStatusChange?: (status: SessionStatus) => void
}

export class Session {
  readonly id: string
  readonly parentMessageId: string
  readonly parts: Part[] = []
  readonly toolCalls: Map<ToolCallID, ToolCallPart> = new Map()
  readonly toolResults: Map<ToolCallID, ToolResultPart> = new Map()

  status: SessionStatus = "running"
  error?: string
  finishReason?: FinishReason
  usage?: Usage
  callbacks?: SessionCallbacks

  // Internal tracking for in-flight parts
  private currentTextPart?: TextPart
  private currentTextId?: ContentBlockID
  private reasoningParts: Map<ContentBlockID, ReasoningPart> = new Map()
  private toolInputBuffers: Map<ToolCallID, string> = new Map()

  constructor(parentMessageId: string, callbacks?: SessionCallbacks) {
    this.id = generateId()
    this.parentMessageId = parentMessageId
    this.callbacks = callbacks
  }

  private nextPartId(): PartID {
    return `part_${generateId()}`
  }

  private setStatus(status: SessionStatus) {
    this.status = status
    this.callbacks?.onStatusChange?.(status)
  }

  private addPart(part: Part) {
    this.parts.push(part)
    this.callbacks?.onPartAdded?.(part)
  }

  private updatePart(part: Part) {
    const idx = this.parts.findIndex((p) => p.id === part.id)
    if (idx >= 0) {
      this.parts[idx] = part
      this.callbacks?.onPartUpdated?.(part)
    }
  }

  private emit(event: SessionEvent) {
    this.callbacks?.onEvent(event)
  }

  // ─── LLM Event handling (ported from opencode's processor.handleEvent) ───

  handleEvent(event: LLMEvent) {
    switch (event.type) {
      case "step-start":
        this.handleStepStart(event)
        break
      case "step-finish":
        this.handleStepFinish(event)
        break
      case "text-start":
        this.handleTextStart(event)
        break
      case "text-delta":
        this.handleTextDelta(event)
        break
      case "text-end":
        this.handleTextEnd(event)
        break
      case "reasoning-start":
        this.handleReasoningStart(event)
        break
      case "reasoning-delta":
        this.handleReasoningDelta(event)
        break
      case "reasoning-end":
        this.handleReasoningEnd(event)
        break
      case "tool-input-start":
        this.handleToolInputStart(event)
        break
      case "tool-input-delta":
        this.handleToolInputDelta(event)
        break
      case "tool-input-end":
        this.handleToolInputEnd(event)
        break
      case "tool-call":
        this.handleToolCall(event)
        break
      case "tool-result":
        this.handleToolResult(event)
        break
      case "tool-error":
        this.handleToolError(event)
        break
      case "finish":
        this.handleFinish(event)
        break
      case "provider-error":
        this.handleProviderError(event)
        break
    }
  }

  private handleStepStart(_event: LLMEvent & { type: "step-start" }) {
    // Step tracking — for now a no-op
  }

  private handleStepFinish(event: LLMEvent & { type: "step-finish" }) {
    this.finishReason = event.reason
    this.usage = event.usage
    this.emitUsage()
  }

  private emitUsage() {
    if (this.usage) {
      this.emit({
        type: "usage",
        inputTokens: this.usage.inputTokens ?? 0,
        outputTokens: this.usage.outputTokens ?? 0,
        reasoningTokens: this.usage.reasoningTokens ?? 0,
      })
    }
  }

  private handleTextStart(event: LLMEvent & { type: "text-start" }) {
    this.currentTextId = event.id
    const part: TextPart = {
      type: "text",
      id: this.nextPartId(),
      text: "",
      providerMetadata: event.providerMetadata,
    }
    this.currentTextPart = part
    this.addPart(part)
  }

  private handleTextDelta(event: LLMEvent & { type: "text-delta" }) {
    if (!this.currentTextPart) return
    this.currentTextPart.text += event.text
    if (event.providerMetadata) {
      this.currentTextPart.providerMetadata = event.providerMetadata
    }
    this.emit({ type: "text-delta", text: event.text })
  }

  private handleTextEnd(_event: LLMEvent & { type: "text-end" }) {
    if (this.currentTextPart) {
      this.currentTextPart.text = this.currentTextPart.text
      this.updatePart(this.currentTextPart)
      this.currentTextPart = undefined
      this.currentTextId = undefined
    }
  }

  private handleReasoningStart(event: LLMEvent & { type: "reasoning-start" }) {
    const part: ReasoningPart = {
      type: "reasoning",
      id: this.nextPartId(),
      text: "",
      providerMetadata: event.providerMetadata,
    }
    this.reasoningParts.set(event.id, part)
    this.addPart(part)
  }

  private handleReasoningDelta(event: LLMEvent & { type: "reasoning-delta" }) {
    const part = this.reasoningParts.get(event.id)
    if (!part) return
    part.text += event.text
    if (event.providerMetadata) part.providerMetadata = event.providerMetadata
    this.emit({ type: "reasoning-delta", text: event.text })
  }

  private handleReasoningEnd(event: LLMEvent & { type: "reasoning-end" }) {
    const part = this.reasoningParts.get(event.id)
    if (!part) return
    if (event.providerMetadata) part.providerMetadata = event.providerMetadata
    this.updatePart(part)
    this.reasoningParts.delete(event.id)
  }

  private handleToolInputStart(event: LLMEvent & { type: "tool-input-start" }) {
    this.toolInputBuffers.set(event.id, "")
  }

  private handleToolInputDelta(event: LLMEvent & { type: "tool-input-delta" }) {
    const buf = this.toolInputBuffers.get(event.id)
    if (buf !== undefined) {
      this.toolInputBuffers.set(event.id, buf + event.text)
    }
  }

  private handleToolInputEnd(event: LLMEvent & { type: "tool-input-end" }) {
    // Buffer is preserved for tool-call event that follows
  }

  private handleToolCall(event: LLMEvent & { type: "tool-call" }) {
    const part: ToolCallPart = {
      type: "tool-call",
      id: this.nextPartId(),
      toolCallId: event.id,
      name: event.name,
      input: event.input,
      providerExecuted: event.providerExecuted,
      providerMetadata: event.providerMetadata,
    }
    this.toolCalls.set(event.id, part)
    this.addPart(part)
    this.toolInputBuffers.delete(event.id)

    this.emit({
      type: "tool-start",
      tool: event.name,
      args: event.input,
      toolCallId: event.id,
    })

    this.setStatus("tools-pending")
  }

  private handleToolResult(event: LLMEvent & { type: "tool-result" }) {
    const callPart = this.toolCalls.get(event.id)
    if (!callPart) return

    const part: ToolResultPart = {
      type: "tool-result",
      id: this.nextPartId(),
      toolCallId: event.id,
      name: event.name,
      result: event.result,
      providerExecuted: event.providerExecuted ?? callPart.providerExecuted,
      providerMetadata: event.providerMetadata,
    }
    this.toolResults.set(event.id, part)
    this.addPart(part)

    const errorResult = event.result.type === "error" ? String(event.result.value) : undefined
    this.emit({
      type: "tool-end",
      tool: event.name,
      args: callPart.input,
      status: event.result.type === "error" ? "error" : "success",
      result: event.result.value,
      error: errorResult,
      toolCallId: event.id,
    })

    this.toolCalls.delete(event.id)
    if (this.toolCalls.size === 0) {
      this.setStatus("running")
    }
  }

  private handleToolError(event: LLMEvent & { type: "tool-error" }) {
    const callPart = this.toolCalls.get(event.id)
    if (!callPart) return

    const result: ToolResultValue = { type: "error", value: event.message }
    const part: ToolResultPart = {
      type: "tool-result",
      id: this.nextPartId(),
      toolCallId: event.id,
      name: event.name,
      result,
      providerMetadata: event.providerMetadata,
    }
    this.toolResults.set(event.id, part)
    this.addPart(part)

    this.emit({
      type: "tool-end",
      tool: event.name,
      args: callPart.input,
      status: "error",
      error: event.message,
      toolCallId: event.id,
    })

    this.toolCalls.delete(event.id)
    if (this.toolCalls.size === 0) {
      this.setStatus("running")
    }
  }

  private handleFinish(event: LLMEvent & { type: "finish" }) {
    this.finishReason = event.reason
    this.usage = event.usage
    this.setStatus("finished")
  }

  private handleProviderError(event: LLMEvent & { type: "provider-error" }) {
    this.error = event.message
    this.setStatus("error")
    this.emit({ type: "error", message: event.message })
  }

  // ─── Queries ─────────────────────────────────

  getText(): string {
    return this.parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("")
  }

  getReasoning(): string {
    return this.parts
      .filter((p): p is ReasoningPart => p.type === "reasoning")
      .map((p) => p.text)
      .join("")
  }

  getPendingToolCalls(): ToolCallPart[] {
    return Array.from(this.toolCalls.values())
  }

  hasPendingToolCalls(): boolean {
    return this.toolCalls.size > 0
  }

  isFinished(): boolean {
    return this.status === "finished" || this.status === "error"
  }

  // ─── Provider message conversion ──────────────
  // Converts a list of SessionMessage (the conversation history)
  // into ProviderMessage[] for the LLM API.

  static toProviderMessages(messages: SessionMessage[]): ProviderMessage[] {
    return messages.map((msg) => {
      const content: ProviderContent[] = []

      for (const part of msg.parts) {
        switch (part.type) {
          case "text":
            content.push({ type: "text", text: part.text })
            break
          case "image":
            content.push({ type: "image", image: part.image, mimeType: part.mimeType })
            break
          case "reasoning":
            // Reasoning parts are typically not sent to the LLM
            break
          case "tool-call":
            content.push({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.name,
              input: part.input,
            })
            break
          case "tool-result": {
            const tc: ToolResultContent =
              part.result.type === "error"
                ? { type: "text", text: String(part.result.value) }
                : part.result.type === "text"
                  ? { type: "text", text: String(part.result.value) }
                  : { type: "json", value: part.result.value }
            content.push({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.name,
              output: tc,
            })
            break
          }
        }
      }

      return { role: msg.role, content }
    })
  }

  // ─── Cleanup ─────────────────────────────────
  dispose() {
    this.currentTextPart = undefined
    this.currentTextId = undefined
    this.reasoningParts.clear()
    this.toolInputBuffers.clear()
    this.callbacks = undefined
  }
}

let idCounter = 0

export function generateId(): string {
  idCounter++
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}${random}${idCounter}`
}
