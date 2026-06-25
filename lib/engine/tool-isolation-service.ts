import {
  createToolCall,
  updateToolCallStatus,
  createToolResult,
} from "@/lib/db/adapter"

const MAX_SUMMARY_LENGTH = 2000

function summarizeFileContent(path: string, content: string): Record<string, unknown> {
  const lines = content.split("\n")
  const totalLines = lines.length
  const trimmed = content.trim()

  // Detect file type by extension
  const ext = path.split(".").pop()?.toLowerCase()

  // Extract top-level imports/exports (heuristic for code files)
  const imports: string[] = []
  const exports: string[] = []
  const functions: string[] = []
  const classes: string[] = []
  const interfaces: string[] = []
  const types: string[] = []

  const codeExtensions = new Set(["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "kt", "swift", "c", "cpp", "h", "hpp"])
  const isCode = codeExtensions.has(ext ?? "")

  if (isCode) {
    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith("import ") || t.startsWith("require(") || t.startsWith("from ")) {
        imports.push(t)
      }
      if (t.startsWith("export ") || t.startsWith("module.exports")) {
        exports.push(t)
      }
      if (t.startsWith("function ") || t.startsWith("async function ")) {
        const match = t.match(/(?:async\s+)?function\s+(\w+)/)
        if (match) functions.push(match[1])
      }
      if (t.startsWith("class ")) {
        const match = t.match(/class\s+(\w+)/)
        if (match) classes.push(match[1])
      }
      if (t.startsWith("interface ")) {
        const match = t.match(/interface\s+(\w+)/)
        if (match) interfaces.push(match[1])
      }
      if (t.startsWith("type ") && t.includes("=")) {
        const match = t.match(/type\s+(\w+)/)
        if (match) types.push(match[1])
      }
    }
  }

  const maxPreviewLines = isCode ? 20 : 15
  const head = lines.slice(0, maxPreviewLines).join("\n")
  const tail = totalLines > maxPreviewLines ? lines.slice(-10).join("\n") : ""

  return {
    path,
    size: content.length,
    lines: totalLines,
    type: isCode ? "code" : "text",
    language: ext ?? "unknown",
    imports: imports.length > 15 ? [...imports.slice(0, 15), `...and ${imports.length - 15} more`] : imports,
    exports: exports.length > 10 ? [...exports.slice(0, 10), `...and ${exports.length - 10} more`] : exports,
    functions: functions.slice(0, 20),
    classes: classes.slice(0, 10),
    interfaces: interfaces.slice(0, 10),
    types: types.slice(0, 10),
    preview_head: head,
    preview_tail: totalLines > maxPreviewLines ? tail : undefined,
    message: isCode
      ? `Read ${path} (${totalLines} lines, ${content.length} chars). ${imports.length} imports, ${exports.length} exports, ${functions.length} functions, ${classes.length} classes. Use read_file again with a section reference if you need to see specific portions.`
      : `Read ${path} (${totalLines} lines, ${content.length} chars).`,
  }
}

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type ToolIsolationConfig = {
  sessionId: string
  enabled: boolean
}

export type ToolLifecycleEvent = {
  type: "pending" | "running" | "completed" | "error"
  toolCallId: string
  toolName: string
  timestamp: number
}

export class ToolIsolationService {
  private currentStepId = ""
  private lifecycleLog: ToolLifecycleEvent[] = []

  constructor(private config: ToolIsolationConfig) {}

  get enabled(): boolean {
    return this.config.enabled
  }

  getLifecycleLog(): readonly ToolLifecycleEvent[] {
    return this.lifecycleLog
  }

  /** Set the step ID for the current engine iteration. */
  setStepId(stepId: string): void {
    this.currentStepId = stepId
  }

  registerToolCall(toolName: string, args: Record<string, unknown>, callNumber: number): string {
    const toolCallId = `${toolName}_${callNumber}_${generateId().slice(0, 8)}`
    if (this.enabled) {
      createToolCall({
        id: toolCallId,
        step_id: this.currentStepId,
        session_id: this.config.sessionId,
        tool_name: toolName,
        args: JSON.stringify(args),
        status: "pending",
        created_at: Date.now(),
      })
    }
    this.lifecycleLog.push({ type: "pending", toolCallId, toolName, timestamp: Date.now() })
    return toolCallId
  }

  markRunning(toolCallId: string, toolName: string): void {
    if (this.enabled) {
      updateToolCallStatus(toolCallId, "running")
    }
    this.lifecycleLog.push({ type: "running", toolCallId, toolName, timestamp: Date.now() })
  }

  completeTool(
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

    this.lifecycleLog.push({
      type: success ? "completed" : "error",
      toolCallId,
      toolName,
      timestamp: Date.now(),
    })

    if (!success) {
      return { error }
    }

    return this.summarize(toolName, data)
  }

  private summarize(toolName: string, data: unknown): unknown {
    if (!data || typeof data !== "object") return data

    const record = data as Record<string, unknown>

    switch (toolName) {
      case "read_file": {
        const content = record.content as string | undefined
        const filePath = record.path as string
        if (typeof content === "string" && typeof filePath === "string") {
          return summarizeFileContent(filePath, content)
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

      case "ask":
        return record

      // generate_image: the result contains a base64 data URL that must NOT
      // be truncated — it is streamed to the client via tool_end for inline
      // rendering. The default pass-through below preserves it as-is.
      case "generate_image":
        return record

      default:
        return record
    }
  }
}
