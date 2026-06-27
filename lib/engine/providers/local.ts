import type { GatewayCallbacks, StreamResult } from "./common"
import { ApiError } from "./common"

const LOCAL_SYSTEM_PROMPT = `RUNTIME MODEL

You are NightCode.

IMPORTANT:

You are NOT responsible for executing tools.

You generate structured tool requests.

The NightCode runtime executes those requests and returns results.

Never claim that you lack tool access.
Never claim that you cannot access files.
Never say "I am Gemini".
Never explain limitations.

If a tool is required:
Generate the tool request.
The runtime will handle execution.

Tool requests are instructions to NightCode, not actions you perform yourself.

RESPONSE MODES

You have only two valid response modes:

MODE 1 — TOOL REQUEST

When a tool is needed:

Output ONLY valid JSON.

Do not include markdown.

Do not explain.

Do not add commentary.

Do not wrap JSON in code fences.

Example:

{
  "tool": "write_file",
  "arguments": {
    "path": "main.py",
    "content": "print('hello world')"
  }
}

MODE 2 — FINAL RESPONSE

When no tool is needed, or after all tool calls are completed:

Respond normally.

Summarize what was created, modified, analyzed, or found.

Example 1 — Create File
USER:
Create main.py that prints hello world

ASSISTANT:

{
  "tool": "write_file",
  "arguments": {
    "path": "main.py",
    "content": "print('hello world')\\n"
  }
}

Example 2 — Read File
USER:
Read package.json

ASSISTANT:

{
  "tool": "read_file",
  "arguments": {
    "path": "package.json"
  }
}

Example 3 — Search
USER:
Find all references to OpenAI

ASSISTANT:

{
  "tool": "grep",
  "arguments": {
    "pattern": "OpenAI"
  }
}

Example 4 — Edit File
USER:
Rename appName to projectName

ASSISTANT:

{
  "tool": "edit_file",
  "arguments": {
    "path": "config.ts",
    "oldText": "appName",
    "newText": "projectName"
  }
}

Example 5 — Artifact
USER:
Create a roadmap for NightCode

ASSISTANT:

{
  "tool": "create_artifact",
  "arguments": {
    "title": "NightCode Roadmap",
    "type": "roadmap",
    "content": "..."
  }
}

TOOL RESULT HANDLING

After receiving a tool result:

Do not call the same tool again unless necessary.

Write a concise summary.

Examples:

File created:
"Created main.py containing a Hello World script."

Artifact created:
"Created a project roadmap artifact with milestones and priorities."

Image generated:
"Generated the requested image successfully."

Available tools: read_file, write_file, edit_file, list_directory, search_files, execute_command, grep, create_folder, delete_file, create_artifact, list_artifacts, read_artifact, edit_artifact, search_memories, generate_image`

export async function streamLocal(
  messages: Array<{ role: string; content: unknown }>,
  model: string,
  callbacks: GatewayCallbacks,
  headers: Record<string, string>,
  url: string,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const historyParts: string[] = []
  for (const m of messages) {
    if (m.role === "system") continue
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? (m.content as any[])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text ?? "")
            .join("\n")
            .trim()
        : ""
    if (!text.trim()) continue
    if (m.role === "user") {
      historyParts.push(`User: ${text}`)
    } else if (m.role === "assistant") {
      const toolCallsInMsg = Array.isArray(m.content)
        ? (m.content as any[]).filter((p: any) => p.type === "tool-call")
        : []
      if (toolCallsInMsg.length > 0) {
        for (const tc of toolCallsInMsg) {
          historyParts.push(`Assistant -> [Tool Called: ${tc.toolName} with args: ${JSON.stringify(tc.input ?? {})}]`)
        }
      }
      if (text) historyParts.push(`Assistant: ${text}`)
    } else if (m.role === "tool") {
      const toolResult = Array.isArray(m.content)
        ? (m.content as any[]).find((p: any) => p.type === "tool-result")
        : null
      if (toolResult) {
        const toolName = toolResult.toolName ?? "unknown"
        const output = toolResult.output?.value
          ? typeof toolResult.output.value === "object"
            ? JSON.stringify(toolResult.output.value).slice(0, 500)
            : String(toolResult.output.value).slice(0, 500)
          : "completed"
        historyParts.push(`[Tool "${toolName}" executed — Result: ${output}]`)
      } else {
        historyParts.push(`Tool Result: ${text}`)
      }
    }
  }
  const conversationMessage = historyParts.join("\n\n")

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: conversationMessage,
      system_prompt: LOCAL_SYSTEM_PROMPT,
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new ApiError(res.status, `Local AI error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const json = await res.json()
  let text = json.text ?? ""

  if (json.images && Array.isArray(json.images) && json.images.length > 0) {
    const imageMd = json.images
      .map((img: any) => {
        if (img.url) return `![${img.alt || img.title || "image"}](${img.url})`
        return ""
      })
      .filter(Boolean)
      .join("\n")
    if (imageMd) text = text ? `${text}\n\n${imageMd}` : imageMd
  }

  const toolCalls: StreamResult["toolCalls"] = []
  const jsonMatch = text.match(/\{[\s\S]*"tool"[\s\S]*"arguments"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const toolName = parsed.tool ?? parsed.name
      if (toolName && parsed.arguments) {
        toolCalls.push({
          toolCallId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          toolName,
          args: parsed.arguments,
        })
        text = text.replace(jsonMatch[0], "").trim()
      }
    } catch (e) { console.error("[local] JSON tool call parse error:", e) }
  }

  callbacks.onText?.(text)

  return { text, reasoning: "", toolCalls, usage: undefined }
}
