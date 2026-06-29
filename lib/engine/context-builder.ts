import type { Message } from "@/types"
import { getCompactionsBySession } from "@/lib/db/adapter"
import { listArtifacts } from "@/lib/engine/artifact-store"
import * as path from "path"
import * as fs from "fs"

// ── Load prompt files at module init ──
const PROMPTS_DIR = path.join(__dirname, "prompts")

function loadPrompt(name: string): string {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, name), "utf-8").trim()
  } catch {
    return ""
  }
}

const PROMPT_DEFAULT = loadPrompt("default.txt")
const PROMPT_GEMINI = loadPrompt("gemini.txt")
const PROMPT_GPT = loadPrompt("gpt.txt")
const PROMPT_ANTHROPIC = loadPrompt("anthropic.txt")
const PROMPT_BEAST = loadPrompt("beast.txt")

function selectPrompt(modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes("o1") || id.includes("o3") || id.includes("o4") || id.includes("o5")
    || id.includes("gpt-5") || id.includes("claude-sonnet-5") || id.includes("deepseek-v4")
    || id.includes("deepseek-r2")) {
    return PROMPT_BEAST
  }
  if (id.includes("claude") || id.includes("anthropic")) return PROMPT_ANTHROPIC
  if (id.includes("gemini") || id.includes("google")) return PROMPT_GEMINI
  if (id.includes("gpt") || id.includes("openai")) return PROMPT_GPT
  return PROMPT_DEFAULT
}

// ── Env block (appended after the model prompt, like opencode) ──
function buildEnvBlock(workspaceRoot: string, modelId: string): string {
  const isGit = fs.existsSync(path.join(workspaceRoot, ".git"))
  return [
    `You are powered by the model named ${modelId}.`,
    "Here is some useful information about the environment you are running in:",
    "<env>",
    `  Working directory: ${workspaceRoot}`,
    `  Workspace root folder: ${workspaceRoot}`,
    `  Is directory a git repo: ${isGit ? "yes" : "no"}`,
    `  Platform: ${process.platform}`,
    `  Today's date: ${new Date().toDateString()}`,
    "</env>",
  ].join("\n")
}

// ── AGENTS.md discovery and loading ──
const AGENTS_MD_FILES = ["AGENTS.md", ".agents/AGENTS.md"]

function discoverAgentsMdFiles(workspaceRoot: string, projectRoot?: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  let current = path.resolve(workspaceRoot)
  const root = path.parse(current).root
  while (true) {
    for (const name of AGENTS_MD_FILES) {
      const p = path.join(current, name)
      if (fs.existsSync(p) && !seen.has(p)) {
        seen.add(p)
        found.push(p)
      }
    }
    if (current === root) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  if (projectRoot && projectRoot !== path.resolve(workspaceRoot)) {
    current = path.resolve(projectRoot)
    while (true) {
      for (const name of AGENTS_MD_FILES) {
        const p = path.join(current, name)
        if (fs.existsSync(p) && !seen.has(p)) {
          seen.add(p)
          found.push(p)
        }
      }
      if (current === root) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return found
}

function getProjectRoot(): string | undefined {
  const scriptDir = __dirname
  let current = path.resolve(scriptDir)
  const root = path.parse(current).root
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) return current
    if (current === root) break
    current = path.dirname(current)
  }
  return undefined
}

function loadAgentsMdInstructions(workspaceRoot: string): string | null {
  const projectRoot = getProjectRoot()
  const files = discoverAgentsMdFiles(workspaceRoot, projectRoot)
  if (files.length === 0) return null
  return files
    .map((filePath) => {
      try {
        const content = fs.readFileSync(filePath, "utf-8").trim()
        return `Instructions from: ${filePath}\n${content}`
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .join("\n\n")
}

// ── System prompt builder ──
// Assembly: model prompt + env block + AGENTS.md
// Matches opencode's approach: model identity first, then environment, then instructions.
export function buildSystemPrompt(modelId: string): string {
  const basePrompt = selectPrompt(modelId)
  const workspaceRoot = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())
  const envBlock = buildEnvBlock(workspaceRoot, modelId)
  const agentsMd = loadAgentsMdInstructions(workspaceRoot)

  const parts = [basePrompt, envBlock]
  if (agentsMd) parts.push(agentsMd)
  return parts.join("\n\n")
}

// ── Mode instruction blocks (opencode-style synthetic user messages) ──
// Exact content from opencode's prompt files: plan.txt and build-switch.txt

export const PLAN_MODE_INSTRUCTIONS = `<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files - commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. Any modification attempt
is a critical violation. ZERO exceptions.

---

## Responsibility

Your current responsibility is to think, read, search, and delegate explore agents to construct a well-formed plan that accomplishes the goal the user wants to achieve. Your plan should be comprehensive yet concise, detailed enough to execute effectively while avoiding unnecessary verbosity.

Ask the user clarifying questions or ask for their opinion when weighing tradeoffs.

**NOTE:** At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.

---

## Important

The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.
</system-reminder>`

export const BUILD_SWITCH_INSTRUCTIONS = `<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and utilize your arsenal of tools as needed.
</system-reminder>`

// ── Simple task detection ──
const SIMPLE_TASK_PATTERNS = [
  /^create\s/i, /^write\s/i, /^make\s/i, /^new\s/i,
  /^read\s/i, /^show\s/i, /^cat\s/i,
  /^run\s/i, /^execute\s/i,
  /^delete\s/i, /^remove\s/i,
  /^edit\s/i, /^update\s/i, /^change\s/i,
  /^rename\s/i, /^move\s/i, /^copy\s/i,
]

export function isSimpleTask(userMessage: string): boolean {
  const trimmed = userMessage.trim()
  if (trimmed.length > 200) return false
  return SIMPLE_TASK_PATTERNS.some((p) => p.test(trimmed))
}

// ── Compaction cache ──
const compactionCache = new Map<string, { block: string; count: number }>()

export function invalidateCompactionCache(sessionId: string): void {
  compactionCache.delete(sessionId)
}

function buildCompactionBlock(sessionId?: string): string | null {
  if (!sessionId) return null
  const cached = compactionCache.get(sessionId)
  if (cached && cached.count > 0) return cached.block
  return null
}

export function buildCompactionBlockFull(
  sessionId: string,
  stepNumber: number,
  provider: string,
  modelId: string,
): string | null {
  const key = `${sessionId}::${provider}::${modelId}`
  const cached = compactionCache.get(key)
  const summaryCount = cached ? cached.count + 1 : 1
  const summary = `[Earlier conversation compacted: steps 1-${stepNumber} summarized. Continuing with recent context only.]`
  const block = `## Compaction Summary\n\n${summary}`
  compactionCache.set(key, { block, count: summaryCount })
  return block
}

export async function buildCompactionRequest(
  messages: Message[],
  sessionId: string,
  provider: string,
  modelId: string,
  stepNumber: number,
): Promise<{ messages: Message[]; system: string }> {
  const compactBlock = buildCompactionBlockFull(sessionId, stepNumber, provider, modelId)
  const systemMessage = `You are a context compaction assistant. Your job is to summarize the conversation below into a concise block that preserves all critical information: tool results, file changes, decisions, and next steps.\n\n${compactBlock}`
  return { messages, system: systemMessage }
}

// ── Artifact block ──
function buildArtifactBlock(): string | null {
  const all = listArtifacts()
  if (all.length === 0) return null
  const lines = all.map((a) => `- ${a.id}: "${a.title}" (${a.type}, ${a.content.length} chars)`)
  return `[Stored Artifacts — use list_artifacts, read_artifact, and edit_artifact to interact with these]\n${lines.join("\n")}`
}

// ── Dynamic context block (compaction + artifacts) ──
export function buildDynamicBlock(sessionId?: string): string | null {
  const parts: string[] = []
  const compacted = buildCompactionBlock(sessionId)
  if (compacted) parts.push(compacted)
  const artifactBlock = buildArtifactBlock()
  if (artifactBlock) parts.push(artifactBlock)
  if (parts.length === 0) return null
  return `## Session Context\n\n${parts.join("\n\n")}`
}

// ── Request builder ──
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
  sessionId?: string,
): { system: string; messages: RequestMessage[] } {
  const msgs: RequestMessage[] = messages.map((m) => {
    const raw = m as unknown as { content?: ContentPart[] }
    if (Array.isArray(raw.content)) {
      return { role: m.role, content: raw.content as ContentPart[] }
    }
    return {
      role: m.role,
      content: typeof m.content === "string" ? m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : String(m.content ?? ""),
    }
  })
  const dynamicBlock = buildDynamicBlock(sessionId)
  if (dynamicBlock) {
    msgs.unshift({ role: "user", content: dynamicBlock })
  }
  return { system: systemPrompt, messages: msgs }
}
