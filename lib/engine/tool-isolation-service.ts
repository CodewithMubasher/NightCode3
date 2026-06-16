import {
  createToolCall,
  updateToolCallStatus,
  createToolResult,
} from "@/lib/db/adapter"

const MAX_SUMMARY_LENGTH = 2000

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type ToolIsolationConfig = {
  sessionId: string
  enabled: boolean
}

export class ToolIsolationService {
  private currentStepId = ""

  constructor(private config: ToolIsolationConfig) {}

  get enabled(): boolean {
    return this.config.enabled
  }

  /** Set the step ID for the current engine iteration. */
  setStepId(stepId: string): void {
    this.currentStepId = stepId
  }

  onToolStart(toolName: string, args: Record<string, unknown>, callNumber: number): string {
    const toolCallId = `${toolName}_${callNumber}_${generateId().slice(0, 8)}`
    if (this.enabled) {
      createToolCall({
        id: toolCallId,
        step_id: this.currentStepId,
        session_id: this.config.sessionId,
        tool_name: toolName,
        args: JSON.stringify(args),
        status: "running",
        created_at: Date.now(),
      })
    }
    return toolCallId
  }

  onToolEnd(
    toolCallId: string,
    toolName: string,
    success: boolean,
    data: unknown,
    error: string | null,
    executionTimeMs: number | null,
    evidence: Record<string, unknown> | undefined
  ): unknown {
    const status = success ? "success" : "error"

    if (this.enabled) {
      updateToolCallStatus(toolCallId, status)

      createToolResult({
        id: generateId(),
        tool_call_id: toolCallId,
        step_id: this.currentStepId,
        session_id: this.config.sessionId,
        success: success ? 1 : 0,
        data: success && data ? JSON.stringify(data) : null,
        error,
        execution_time_ms: executionTimeMs,
        created_at: Date.now(),
      })
    }

    if (!success) {
      return { error }
    }

    // Always summarize to avoid context pollution (regardless of enabled flag)
    return this.summarize(toolName, data)
  }

  private summarize(toolName: string, data: unknown): unknown {
    if (!data || typeof data !== "object") return data

    const record = data as Record<string, unknown>

    switch (toolName) {
      case "read_file": {
        const content = record.content as string | undefined
        if (typeof content === "string" && content.length > MAX_SUMMARY_LENGTH) {
          return {
            ...record,
            content: content.slice(0, MAX_SUMMARY_LENGTH) + `\n\n...[truncated: ${content.length} total chars]`,
          }
        }
        return record
      }

      case "write_file":
      case "create_folder":
      case "delete_file":
        return record

      case "list_directory": {
        const items = record.items as Array<{ name: string; type: string }> | undefined
        if (items && items.length > 20) {
          return {
            ...record,
            items: items.slice(0, 20),
            _truncated: true,
            _total_count: items.length,
          }
        }
        return record
      }

      case "execute_command": {
        const asRecord = data as Record<string, unknown>
        const summarized = { ...asRecord }
        for (const key of ["stdout", "stderr"]) {
          const val = summarized[key]
          if (typeof val === "string" && val.length > MAX_SUMMARY_LENGTH) {
            summarized[key] = val.slice(0, MAX_SUMMARY_LENGTH) + `\n\n...[truncated: ${val.length} total chars]`
          }
        }
        return summarized
      }

      case "search_files": {
        const items = record.items as string[] | undefined
        if (items && items.length > 30) {
          return {
            ...record,
            items: items.slice(0, 30),
            _truncated: true,
            _total_count: items.length,
          }
        }
        return record
      }

      case "create_artifact": {
        const content = record.content as string | undefined
        if (typeof content === "string" && content.length > MAX_SUMMARY_LENGTH) {
          return {
            ...record,
            content: content.slice(0, MAX_SUMMARY_LENGTH) + `\n\n...[truncated: ${content.length} total chars]`,
          }
        }
        return record
      }

      case "think":
        return record

      default:
        return record
    }
  }
}
