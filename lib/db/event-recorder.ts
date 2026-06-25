import { initSchema } from "./schema"
import {
  createSession,
  updateSessionStatus,
  createToolCall,
  updateToolCallStatus,
  createToolResult,
  createEvent,
} from "./adapter"

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export class EventRecorder {
  private sessionId: string | null = null
  private sessionCreated = false
  private toolCallMap = new Map<string, string>()

  constructor(
    private chatId: string,
    private messageId: string,
    private provider: string,
    private model: string,
    existingSessionId?: string,
    private skipToolTracking = false
  ) {
    initSchema()
    if (existingSessionId) {
      this.sessionId = existingSessionId
      this.sessionCreated = true
    }
  }

  private ensureSession(): string {
    if (!this.sessionCreated) {
      this.sessionId = this.messageId
      createSession({
        id: this.sessionId,
        chat_id: this.chatId,
        status: "active",
        model: this.model,
        provider: this.provider,
        created_at: Date.now(),
        updated_at: Date.now(),
        metadata: JSON.stringify({ messageId: this.messageId }),
      })
      this.sessionCreated = true
    }
    return this.sessionId!
  }

  record(eventType: string, payload: Record<string, unknown>): void {
    const sid = this.ensureSession()

    switch (eventType) {
      case "tool_start": {
        if (this.skipToolTracking) {
          createEvent({
            session_id: sid,
            event_type: "tool_start",
            payload: JSON.stringify(payload),
            timestamp: Date.now(),
          })
          break
        }
        const tool = (payload.tool as string) ?? "unknown"
        const callNumber = (payload.callNumber as number) ?? 0
        const toolCallId = `${tool}_${callNumber}_${generateId().slice(0, 8)}`
        this.toolCallMap.set(`${tool}_${callNumber}`, toolCallId)

        createToolCall({
          id: toolCallId,
          step_id: "",
          session_id: sid,
          tool_name: tool,
          args: JSON.stringify(payload.args ?? {}),
          status: "running",
          created_at: Date.now(),
        })

        createEvent({
          session_id: sid,
          event_type: "tool_start",
          payload: JSON.stringify(payload),
          timestamp: Date.now(),
        })
        break
      }

      case "tool_end": {
        if (this.skipToolTracking) {
          createEvent({
            session_id: sid,
            event_type: "tool_end",
            payload: JSON.stringify(payload),
            timestamp: Date.now(),
          })
          break
        }
        const tool = (payload.tool as string) ?? "unknown"
        const callNumber = (payload.callNumber as number) ?? 0
        const key = `${tool}_${callNumber}`
        const toolCallId = this.toolCallMap.get(key)
        if (toolCallId) {
          const status = (payload.status as string) === "verified" ? "success" : "error"
          updateToolCallStatus(toolCallId, status as "success" | "error")

          createToolResult({
            id: generateId(),
            tool_call_id: toolCallId,
            step_id: "",
            session_id: sid,
            success: status === "success" ? 1 : 0,
            data: payload.result ? JSON.stringify(payload.result) : null,
            error: (payload.error as string) ?? (payload.discrepancy as string) ?? null,
            execution_time_ms: null,
            created_at: Date.now(),
          })
        }

        createEvent({
          session_id: sid,
          event_type: "tool_end",
          payload: JSON.stringify(payload),
          timestamp: Date.now(),
        })
        break
      }

      case "artifact": {
        createEvent({
          session_id: sid,
          event_type: "artifact",
          payload: JSON.stringify(payload),
          timestamp: Date.now(),
        })
        break
      }

      case "text_delta": {
        createEvent({
          session_id: sid,
          event_type: eventType,
          payload: JSON.stringify(payload),
          timestamp: Date.now(),
        })
        break
      }

      case "error": {
        updateSessionStatus(sid, "error")
        createEvent({
          session_id: sid,
          event_type: "error",
          payload: JSON.stringify(payload),
          timestamp: Date.now(),
        })
        break
      }

      case "thinking": {
        createEvent({
          session_id: sid,
          event_type: "thinking",
          payload: JSON.stringify(payload),
          timestamp: Date.now(),
        })
        break
      }

      case "message_complete": {
        updateSessionStatus(sid, "completed")
        createEvent({
          session_id: sid,
          event_type: "message_complete",
          payload: JSON.stringify(payload ?? {}),
          timestamp: Date.now(),
        })
        break
      }

      case "usage": {
        createEvent({
          session_id: sid,
          event_type: "usage",
          payload: JSON.stringify(payload),
          timestamp: Date.now(),
        })
        break
      }
    }
  }
}
