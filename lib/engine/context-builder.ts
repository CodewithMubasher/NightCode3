import type { Message } from "@/types"
import type { ToolImplementation } from "./tools"
import { getCompactionsBySession } from "@/lib/db/adapter"
import { listArtifacts } from "@/lib/engine/artifact-store"

const AGENT_PROMPT = `You are NightCode, an intelligent AI coding assistant with access to tools.

Assess the user's request and decide how to respond:
- Conversation or questions → respond directly, no tools needed.
- Create, read, modify, search, delete files → use the appropriate tools.
- Need multiple files → create them all before responding.
- Structured document (plan, roadmap, PRD, spec, guide) → use create_artifact.
- Complex or ambiguous build requests → use ask tool first to gather requirements.
- Image request (draw, generate, create an image, visualize) → use generate_image tool immediately. Do NOT describe the image in text — call the tool.

ASK BEFORE BUILDING: For complex requests (building apps, creating projects, implementing features), use the ask tool to gather requirements first. Ask about tech stack, features, design preferences, and other relevant details. Give users maximum 4 options per question and keep them simple. Do NOT build anything until the user has answered your questions. The ask tool organizes questions into tabs, each tab containing related questions.

DEPTH RULE: For investigative tasks (analyze, find bugs, review, audit, explore) — plan your approach first, then execute each phase fully. Only respond when you have read the actual source files and have real evidence. Listing files is not evidence. Reading and understanding file contents is evidence. Cite specific file paths and findings in your response.

PARALLEL TOOL RULE: You can call multiple independent tools in a single step. For example, if you need to read three files or list two directories, do it in one response. Group independent operations together for efficiency. Dependent operations (e.g., read a file after listing its directory) must still be sequential.

ARTIFACT TOOLS: Use list_artifacts to see stored artifacts, read_artifact to view full content, and edit_artifact to update them. These are your second brain — reuse and refine artifacts across conversations.
SEARCH MEMORIES: Use search_memories to find relevant facts, decisions, and project context from past conversations stored in artifacts. Search before creating new artifacts to avoid duplicates.

FILE PATHS: All paths are relative to the workspace directory. Use "project/index.html", not "/project/index.html" or "C:/project/index.html". Do not start paths with /.

SILENT BUILDING: When building or writing code, call tools immediately. Do NOT output any text describing what you will do or explaining your plan. No "I'll create...", no "Let me build...", no "First I'll...". Silence the narration. Call the tools. If you need to explain what was done, do it as a single summary AFTER all tool calls complete.

PROJECT CREATION: When initializing a project or creating multiple files for a feature, you MUST batch all file writes into a SINGLE parallel step. Do not create files one at a time — the system supports parallel tool calls. Call write_file for every file simultaneously.

SURGICAL EDITS: For small changes (fix a typo, rename a variable, update a single line), use edit_file instead of write_file. edit_file replaces exact text without regenerating the entire file. This is faster and uses fewer tokens.

CONTENT SEARCH: Use grep to search file contents for patterns (function names, imports, variables). It returns matching lines with line numbers. Use read_file with offset and limit to read specific sections of a file instead of the entire file.

RESPONSE FORMATTING: Structure your responses using headings, bullet lists, and code blocks. Never output large unstructured paragraphs. Use concise, scannable formatting that makes the information easy to digest.

IMAGE GENERATION:
- When a user asks to generate, draw, create, or visualize an image → call generate_image immediately.
- You MUST generate a unique image_id for each call (use a short UUID like "img_abc123").
- Write a detailed, vivid prompt. The more specific, the better the result.
- Choose aspect_ratio based on the request: portraits → 9:16, landscapes/wallpapers → 16:9, square/general → 1:1.
- After the tool completes, write ONE short sentence describing what was generated. Do not re-describe the prompt.
- You can generate multiple images in parallel by calling generate_image multiple times in one step.

VISION / FILE UNDERSTANDING:
- When the user attaches an image, you can see it directly. Describe, analyze, or use it as instructed.
- When the user attaches a PDF or text file, the content is included in the message. Read and use it.
- Always acknowledge attached files in your response.`

// ── BEAST-style prompt for fast/reasoning models (o-series, fast models) ──
const BEAST_PROMPT = `You are NightCode — an autonomous coding agent. Keep going until the task is solved.

You have everything you need. Do NOT stop at analysis or partial fixes. Carry changes through implementation, verification, and a clear summary.

RULES:
- Do the work. Do not plan. Do not describe what you will do. Call tools immediately.
- If a tool call fails, fix the issue and retry. Do not give up.
- If you need more context, search the codebase with grep and read files.
- Use expert_agent for complex multi-file investigations or refactors.
- When done, emit a concise summary. Do not narrate your process.

${/* The core rules from AGENT_PROMPT that apply to all modes: */""}
SURGICAL EDITS: For small changes use edit_file. edit_file replaces exact text without regenerating the entire file.

CONTENT SEARCH: Use grep to search file contents. It returns matching lines with line numbers.

PARALLEL TOOL RULE: Call multiple independent tools in a single step. Group independent operations together for efficiency.

FILE PATHS: All paths are relative to the workspace directory. Use "project/index.html", not "/project/index.html".

IMAGE GENERATION: When asked to generate an image, call generate_image immediately with a detailed prompt and a unique image_id. Do not output text first.`

const CAAT_PROMPT = `You are NightCode running in CODE-AS-A-TOOL (CaaT) mode.

You have ONE tool: execute_workspace_script. You MUST use it for every request. Never output planning text — write code and call the tool immediately.

Available workspace API:
- workspace.findFiles(glob: string): Promise<string[]> — Find files matching a glob pattern (e.g. "src/**/*.ts")
- workspace.readFile(path: string): Promise<string> — Read entire file
- workspace.readFileSection(path, offset, limit): Promise<string> — Read specific lines (1-based)
- workspace.writeFile(path, content): Promise<void> — Create or overwrite a file
- workspace.patchFile(path, oldString, newString): Promise<boolean> — Replace exact text in a file
- workspace.executeCommand(cmd): Promise<{stdout, stderr, exitCode}> — Run a shell command
- workspace.listDirectory(path): Promise<Array<{name, type, size}>> — List directory contents

RULES:
1. Call execute_workspace_script IMMEDIATELY on every request. Do not output text first. Do not plan. Do not describe what you will do.
2. Write TypeScript code that does EVERYTHING in one script. Structure it as "async function run(workspace) { ... }".
3. Use findFiles + readFile to discover code before modifying. Use patchFile for surgical edits.
4. Log progress with console.log() — all logs appear in the response.
5. Handle errors with try/catch. If the script fails, read the error and call again with fixed code.
6. Only respond with text AFTER the script executes and you see results. Then summarize what was done.

Examples:
WRONG: "Okay, I'll create a plan. First we need..."
RIGHT: execute_workspace_script({ typescript_code: "async function run(workspace) { await workspace.writeFile('index.html', '<!DOCTYPE html>...'); console.log('done'); }" })

WRONG: "Let me search for where auth is validated..."
RIGHT: execute_workspace_script({ typescript_code: "async function run(workspace) { const files = await workspace.findFiles('src/**/*.ts'); for (const f of files) { const c = await workspace.readFile(f); if (c.includes('jwt')) console.log(f); } }" })

The user wants results, not plans. Write code. Call the tool. Then summarize.`

export function buildSystemPrompt(mode?: "standard" | "caat", mcpTools?: ToolImplementation[], modelId?: string): string {

  function isBeastModel(id: string): boolean {
    const lower = id.toLowerCase()
    return lower.includes("o1") || lower.includes("o3") || lower.includes("o4") || lower.includes("o5")
      || lower.includes("gpt-5") || lower.includes("claude-sonnet-5")
      || lower.includes("deepseek-v4")
  }

  const base = mode === "caat"
    ? CAAT_PROMPT
    : (modelId && isBeastModel(modelId) ? BEAST_PROMPT : AGENT_PROMPT)

  if (!mcpTools || mcpTools.length === 0) return base

  const mcpSection = mcpTools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n")

  return `${base}

You also have access to these connected external tools:
${mcpSection}`
}

// ── In-memory compaction cache ──────────────────────────────────────────────
const compactionCache = new Map<string, { block: string; count: number }>()

export function invalidateCompactionCache(sessionId: string): void {
  compactionCache.delete(sessionId)
}

function buildCompactionBlock(sessionId?: string): string | null {
  if (!sessionId) return null

  const cached = compactionCache.get(sessionId)
  if (cached && cached.count > 0) return cached.block

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

  const block = `[Compacted History — earlier steps summarized for context]
${summaries.join("\n\n")}`
  compactionCache.set(sessionId, { block, count: compactions.length })
  return block
}

function buildArtifactBlock(): string | null {
  const all = listArtifacts()
  if (all.length === 0) return null
  const lines = all.map((a) => `- ${a.id}: "${a.title}" (${a.type}, ${a.content.length} chars)`)
  return `[Stored Artifacts — use list_artifacts, read_artifact, and edit_artifact to interact with these]
${lines.join("\n")}`
}

export function buildDynamicBlock(sessionId?: string): string | null {
  const parts: string[] = []
  const compacted = buildCompactionBlock(sessionId)
  if (compacted) parts.push(compacted)
  const artifactBlock = buildArtifactBlock()
  if (artifactBlock) parts.push(artifactBlock)
  if (parts.length === 0) return null
  return `## Session Context\n\n${parts.join("\n\n")}`
}

// ── Multimodal content part types ──────────────────────────────────────────
type TextPart = { type: "text"; text: string }
type ImagePart = { type: "image"; image: string; mimeType: string }
type FilePart = { type: "file"; data: string; mimeType: string; filename?: string }
type ContentPart = TextPart | ImagePart | FilePart

type MessageContent = string | ContentPart[]

interface RequestMessage {
  role: string
  content: MessageContent
}

export function buildRequest(
  messages: Message[],
  systemPrompt: string,
  sessionId?: string
): { system: string; messages: RequestMessage[] } {
  // Preserve multimodal content — if the message has array content (passed from store),
  // keep it as-is. Otherwise extract the text string.
  const msgs: RequestMessage[] = messages.map((m) => {
    // The store sends pre-built multimodal payloads for messages with attachments.
    // The content field on Message is always a string (display text), but the API
    // payload built in nightcode-store already serialises attachments into parts.
    // We trust whatever arrived in `m` — if it has a `parts` field use that,
    // otherwise fall back to the string content.
    const raw = m as any
    if (Array.isArray(raw.content)) {
      return { role: m.role, content: raw.content as ContentPart[] }
    }
    return {
      role: m.role,
      content: m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    }
  })

  const dynamicBlock = buildDynamicBlock(sessionId)
  if (dynamicBlock) {
    msgs.unshift({ role: "user", content: dynamicBlock })
  }

  return { system: systemPrompt, messages: msgs }
}

export function buildContext(
  messages: Message[],
  systemPrompt: string,
  sessionId?: string
): Array<{ role: string; content: MessageContent }> {
  const { system, messages: msgs } = buildRequest(messages, systemPrompt, sessionId)
  return [{ role: "system", content: system }, ...msgs]
}