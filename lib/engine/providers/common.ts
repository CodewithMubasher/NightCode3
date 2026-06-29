export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
}

export interface GatewayCallbacks {
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  onToolCallStart?: (toolCallId: string, name: string) => void
  onToolCallDelta?: (toolCallId: string, text: string) => void
}

export interface StreamResult {
  text: string
  reasoning: string
  toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> | null }>
  finishReason?: string
  usage?: UsageInfo
}

export interface ToolDef {
  name: string
  description: string
  schema: Record<string, string | any>
}

export function getTemperature(modelId: string): number | undefined {
  const id = modelId.toLowerCase()
  if (id.includes("qwen")) return 0.55
  if (id.includes("gemini")) return 1.0
  if (id.includes("o1") || id.includes("o3") || id.includes("o4") || id.includes("o5")) return 1.0
  if (id.includes("gpt-5")) return 1.0
  if (id.includes("deepseek")) return 0.7
  if (id.includes("claude-sonnet-5")) return 1.0
  if (id.includes("claude")) return undefined
  return 0.3
}

/**
 * Convert a single schema value (simple type string or Zod type) into a JSON Schema property.
 */
export function schemaValueToJsonSchema(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && "_def" in value) {
    const def = (value as any)._def
    const type = def?.type as string | undefined

    // This project uses a custom Zod implementation where _def.type is a lowercase
    // string (e.g. "string", "array", "object") instead of standard Zod's _def.typeName
    // (e.g. "ZodString", "ZodArray", "ZodObject").
    switch (type) {
      case "string": return { type: "string" }
      case "number": return { type: "number" }
      case "boolean": return { type: "boolean" }
      case "array":
        return { type: "array", items: schemaValueToJsonSchema(def.element) }
      case "object": {
        const shape = def.shape ?? {}
        const properties: Record<string, unknown> = {}
        const required: string[] = []
        for (const [key, val] of Object.entries(shape)) {
          properties[key] = schemaValueToJsonSchema(val)
          if ((val as any)?._def?.type !== "optional" && (val as any)?._def?.type !== "nullable" && (val as any)?._def?.type !== "default") {
            required.push(key)
          }
        }
        return {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: false,
        }
      }
      case "enum": {
        const entries = def.entries as Record<string, string> | undefined
        return { type: "string", enum: entries ? Object.values(entries) : undefined }
      }
      case "optional":
        return { ...schemaValueToJsonSchema(def.innerType), optional: true }
      case "nullable":
        return { ...schemaValueToJsonSchema(def.innerType), nullable: true }
      case "default":
        return schemaValueToJsonSchema(def.innerType)
      case "union":
        return {
          anyOf: (def.options as any[]).map((opt: any) => {
            // def.options might be an array of { _def: { type: "string" } } objects
            // or plain type strings like "string", "number"
            return typeof opt === "object" && opt !== null && "_def" in opt
              ? schemaValueToJsonSchema(opt)
              : { type: String(opt) }
          }),
        }
      default:
        return { type: "string" }
    }
  }

  const typeStr = String(value)
  const isOptional = typeStr.endsWith("?")
  const baseType = isOptional ? typeStr.slice(0, -1).trim() : typeStr.trim()

  let tsType: string
  let items: Record<string, unknown> | undefined

  switch (baseType) {
    case "number": tsType = "number"; break
    case "boolean": tsType = "boolean"; break
    case "string[]": tsType = "array"; items = { type: "string" }; break
    case "number[]": tsType = "array"; items = { type: "number" }; break
    case "object": tsType = "object"; break
    default: tsType = "string"
  }

  const result: Record<string, unknown> = { type: tsType }
  if (items) result.items = items
  if (isOptional) result.optional = true
  return result
}

export function buildToolsArray(tools: ToolDef[]): unknown[] {
  return tools.map((t) => {
    const entries = Object.entries(t.schema)
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, value] of entries) {
      const prop = schemaValueToJsonSchema(value)
      properties[key] = prop

      // Determine if optional: check both our convention and Zod Optional
      const isOptional =
        (typeof value === "string" && value.endsWith("?")) ||
        (value && typeof value === "object" && "_def" in value &&
          ((value as any)._def?.type === "optional" || (value as any)._def?.type === "nullable" || (value as any)._def?.type === "default"))

      if (!isOptional) {
        required.push(key)
      }
    }

    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
          additionalProperties: false,
        },
      },
    }
  })
}

export function getModelParam(provider: string, model: string): string {
  return model
}

export function extractInlineToolCalls(text: string): StreamResult["toolCalls"] {
  const toolCalls: StreamResult["toolCalls"] = []
  const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/g
  const inlineJsonRegex = /\{[\s\S]*?"(?:name|function\s*\.?\s*name)"\s*:[\s\S]*?"(?:arguments|function\s*\.?\s*arguments)"\s*:[\s\S]*?\}/g

  const candidates: string[] = []

  let match: RegExpExecArray | null
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    candidates.push(match[1])
  }

  while ((match = inlineJsonRegex.exec(text)) !== null) {
    candidates.push(match[0])
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      const name =
        (parsed as any).name ??
        (parsed as any).function?.name ??
        (parsed as any).tool_name ??
        (parsed as any).toolName
      let args =
        (parsed as any).arguments ??
        (parsed as any).function?.arguments ??
        (parsed as any).args ??
        (parsed as any).parameters
      if (name && args) {
        if (typeof args === "string") {
          try { args = JSON.parse(args) } catch { args = {} }
        }
        if (typeof args === "object" && args !== null && !Array.isArray(args)) {
          if (!toolCalls.some((tc) => tc.toolName === name)) {
            toolCalls.push({
              toolCallId: `call_inline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              toolName: name,
              args: args as Record<string, unknown>,
            })
          }
        }
      }
    } catch {
      // skip malformed JSON
    }
  }

  return toolCalls
}

export function formatOpenAIMessages(
  messages: Array<{ role: string; content: unknown }>,
): Array<{ role: string; content: string | Array<Record<string, unknown>> | null; tool_call_id?: string; tool_calls?: Array<Record<string, unknown>> }> {
  const out: Array<{ role: string; content: string | Array<Record<string, unknown>> | null; tool_call_id?: string; tool_calls?: Array<Record<string, unknown>> }> = []

  for (const m of messages) {
    // ── Tool result message ──────────────────────────────────────────────
    // Engine shape: { role: "tool", content: [{ type:"tool-result", toolCallId, toolName, output }] }
    if (m.role === "tool" && Array.isArray(m.content)) {
      const parts = m.content as Array<Record<string, unknown>>
      // Group by toolCallId so each result becomes its own tool message
      for (const part of parts) {
        const p = part as Record<string, unknown>
        if (p?.type !== "tool-result") continue
        const output = p.output
        let content: string
        if (output && typeof output === "object" && !Array.isArray(output)) {
          const o = output as Record<string, unknown>
          if (o.type === "text" && typeof o.text === "string") {
            content = o.text
          } else if (o.type === "json" && "value" in o) {
            const value = o.value
            content = typeof value === "string" ? value : JSON.stringify(value)
          } else {
            content = JSON.stringify(output)
          }
        } else if (typeof output === "string") {
          content = output
        } else {
          content = JSON.stringify(output)
        }
        console.log(`[format] tool result: id=${p.toolCallId} name=${p.toolName} contentLen=${content.length}`)
        out.push({
          role: "tool",
          tool_call_id: (p.toolCallId as string) ?? `call_${Date.now()}`,
          content,
        })
      }
      continue
    }

    // ── Assistant message with tool-call parts ──────────────────────────
    // Engine shape: { role:"assistant", content:[{type:"text"|"tool-call", ...}] }
    // OpenAI REQUIRES: { role:"assistant", content: <text|null>, tool_calls: [...] }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const parts = m.content as Array<Record<string, unknown>>
      const textParts = parts.filter((p) => p.type === "text") as Array<{ type: string; text?: string }>
      const toolCallParts = parts.filter((p) => p.type === "tool-call") as Array<{ type: string; toolCallId?: string; toolName?: string; input?: unknown }>

      const textContent = textParts.map((p) => p.text ?? "").join("").trim()
      if (!textContent && toolCallParts.length === 0) {
        out.push({ role: "assistant", content: "" })
        continue
      }
      const assistantMsg: { role: string; content: string; tool_calls?: Array<Record<string, unknown>> } = {
        role: "assistant",
        content: textContent || "",
      }
      if (toolCallParts.length > 0) {
        assistantMsg.tool_calls = toolCallParts.map((p) => ({
          id: (p.toolCallId as string) ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: "function",
          function: {
            name: p.toolName as string,
            arguments: p.input ? JSON.stringify(p.input) : "{}",
          },
        }))
        console.log(`[format] assistant with ${toolCallParts.length} tool-call(s): ${toolCallParts.map(p => `${p.toolName}[${p.toolCallId}]`).join(', ')}`)
      }
      out.push(assistantMsg)
      continue
    }

    // ── Plain string content (system / user / assistant text) ──────────
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content })
      continue
    }

    // ── Multimodal array content on a non-assistant role (user image/file) ──
    if (Array.isArray(m.content)) {
      const parts = (m.content as Array<Record<string, unknown>>).map((p) => {
        if (p.type === "text") return { type: "text", text: p.text }
        if (p.type === "image") {
          const b64 = (p.image as string) ?? ""
          const mime = (p.mimeType as string) ?? "image/png"
          return { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        }
        if (p.type === "file") {
          const b64 = (p.data as string) ?? ""
          const mime = (p.mimeType as string) ?? "application/pdf"
          return { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        }
        return { type: "text", text: JSON.stringify(p) }
      })
      out.push({ role: m.role, content: parts })
      continue
    }

    // Fallback — should rarely happen
    out.push({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })
  }

  return out
}
