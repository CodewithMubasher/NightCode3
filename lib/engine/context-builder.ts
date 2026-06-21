import type { Message } from "@/types"
import type { ToolImplementation } from "./tools"
import { getCompactionsBySession } from "@/lib/db/adapter"
import { listArtifacts } from "@/lib/engine/artifact-store"

// No OUTPUT FORMAT section needed — the SDK negotiates tool calling format
// natively with each provider (OpenAI function calling, Gemini, Groq, etc.)
// Adding JSON format instructions here would confuse the model since it's no
// longer expected to output JSON manually.

const AGENT_PROMPT = `You are NightCode, an intelligent AI coding assistant with access to tools.

Assess the user's request and decide how to respond:
- Conversation or questions → respond directly, no tools needed.
- Create, read, modify, search, delete files → use the appropriate tools.
- Need multiple files → create them all before responding.
- Structured document (plan, roadmap, PRD, spec, guide) → use create_artifact.
- Complex or ambiguous build requests → use ask tool first to gather requirements.

ASK BEFORE BUILDING: For complex requests (building apps, creating projects, implementing features), use the ask tool to gather requirements first. Ask about tech stack, features, design preferences, and other relevant details. Give users maximum 4 options per question and keep them simple. Do NOT build anything until the user has answered your questions. The ask tool organizes questions into tabs, each tab containing related questions.

DEPTH RULE: For investigative tasks (analyze, find bugs, review, audit, explore) — plan your approach first, then execute each phase fully. Only respond when you have read the actual source files and have real evidence. Listing files is not evidence. Reading and understanding file contents is evidence. Cite specific file paths and findings in your response.

PARALLEL TOOL RULE: You can call multiple independent tools in a single step. For example, if you need to read three files or list two directories, do it in one response. Group independent operations together for efficiency. Dependent operations (e.g., read a file after listing its directory) must still be sequential.

DELEGATE TASK: For large codebase investigations that would require reading many files, use delegate_task to spawn a focused sub-agent. Specify the task, files to examine, and focus area. The sub-agent will return a structured summary so you don't drown in raw file contents. Use multiple delegate_task calls in parallel to investigate different areas simultaneously.

ARTIFACT TOOLS: Use list_artifacts to see stored artifacts, read_artifact to view full content, and edit_artifact to update them. These are your second brain — reuse and refine artifacts across conversations.
SEARCH MEMORIES: Use search_memories to find relevant facts, decisions, and project context from past conversations stored in artifacts. Search before creating new artifacts to avoid duplicates.`

export function buildSystemPrompt(mcpTools?: ToolImplementation[]): string {
  if (!mcpTools || mcpTools.length === 0) return AGENT_PROMPT

  // MCP tools are passed to the SDK as native tools, but we mention them
  // in the prompt so the model knows they exist and what they're for.
  const mcpSection = mcpTools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n")

  return `${AGENT_PROMPT}

You also have access to these connected external tools:
${mcpSection}`
}

function buildCompactionBlock(sessionId?: string): string | null {
  if (!sessionId) return null
  const compactions = getCompactionsBySession(sessionId)
  if (compactions.length === 0) return null

  const summaries = compactions.map((c) => {
    try {
      const s = JSON.parse(c.summary)
      return `Steps ${c.step_range_start}-${c.step_range_end}:
- Goal: ${s.goal ?? "N/A"}
- Progress: ${(s.progress ?? []).join(", ")}
- Blockers: ${(s.blockers ?? []).join(", ") || "None"}
- Files: ${(s.files ?? []).join(", ") || "N/A"}
- Next: ${(s.next ?? []).join(", ") || "N/A"}`
    } catch {
      return null
    }
  }).filter(Boolean)

  if (summaries.length === 0) return null

  return `[Compacted History — earlier steps summarized for context]
${summaries.join("\n\n")}`
}

function buildArtifactBlock(): string | null {
  const all = listArtifacts()
  if (all.length === 0) return null
  const lines = all.map((a) => `- ${a.id}: "${a.title}" (${a.type}, ${a.content.length} chars)`)
  return `[Stored Artifacts — use list_artifacts, read_artifact, and edit_artifact to interact with these]
${lines.join("\n")}`
}

function buildSystemMessage(mcpTools?: ToolImplementation[]): string {
  const basePrompt = buildSystemPrompt(mcpTools)
  return basePrompt
}

/** Builds the full system prompt string and returns conversation messages separately. */
export function buildRequest(
  messages: Message[],
  systemPrompt: string,
  sessionId?: string
): { system: string; messages: Array<{ role: string; content: string }> } {
  let combinedSystem = systemPrompt

  const compacted = buildCompactionBlock(sessionId)
  if (compacted) {
    combinedSystem += "\n\n" + compacted
  }

  const artifactBlock = buildArtifactBlock()
  if (artifactBlock) {
    combinedSystem += "\n\n" + artifactBlock
  }

  const msgs = messages.map((m) => ({ role: m.role, content: m.content }))

  return { system: combinedSystem, messages: msgs }
}

// Kept for backward compatibility — delegates to buildRequest
export function buildContext(
  messages: Message[],
  systemPrompt: string,
  sessionId?: string
): Array<{ role: string; content: string }> {
  const { system, messages: msgs } = buildRequest(messages, systemPrompt, sessionId)
  return [{ role: "system", content: system }, ...msgs]
}
