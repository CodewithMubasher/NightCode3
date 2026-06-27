import * as fs from "fs"
import * as path from "path"

export function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 7)
}

export function estimateMessageTokens(msg: { role: string; content: unknown }): number {
  if (typeof msg.content === "string") return estimateTokens(msg.content)
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((acc, part) => {
      if (typeof part === "object" && part !== null) {
        const p = part as Record<string, unknown>
        if (p.type === "text" && typeof p.text === "string") return acc + estimateTokens(p.text)
        if (p.type === "tool-call" && p.input) return acc + estimateTokens(JSON.stringify(p.input))
        if (p.type === "tool-result") {
          const output = p.output as Record<string, unknown> | undefined
          if (output?.value) {
            const val = output.value
            if (typeof val === "string") return acc + estimateTokens(val)
            if (typeof val === "object") return acc + estimateTokens(JSON.stringify(val))
          }
          return acc + 20
        }
      }
      return acc
    }, 0)
  }
  return 0
}

export const CLEAR_THRESHOLD_TOKENS = 12000
export const PROTECTED_TOOLS = new Set(["skill"])

export function clearOldToolOutputs(messages: Array<{ role: string; content: unknown }>, keepRecent = 2, mode?: string): number {
  if (mode === "plan") return 0
  let cleared = 0
  const toolMessages = messages
    .map((m, i) => ({ msg: m, index: i }))
    .filter(({ msg }) => msg.role === "tool" && Array.isArray(msg.content))

  if (toolMessages.length <= keepRecent) return 0

  const toClear = toolMessages.slice(0, -keepRecent)
  for (const { msg } of toClear) {
    const parts = msg.content as Array<Record<string, unknown>>
    for (const part of parts) {
      if (part.type !== "tool-result") continue
      const toolName = part.toolName as string
      if (PROTECTED_TOOLS.has(toolName)) continue
      const output = part.output as Record<string, unknown> | undefined
      if (!output || typeof output !== "object") continue
      const val = output.value
      const tokenCount = typeof val === "string" ? estimateTokens(val) : typeof val === "object" && val !== null ? estimateTokens(JSON.stringify(val)) : 0
      if (tokenCount > CLEAR_THRESHOLD_TOKENS) {
        part.output = { type: "json" as const, value: `[Tool result processed: ${toolName}]` }
        cleared++
      }
    }
  }
  return cleared
}

export function countFilesRecursive(dir: string): number {
  let count = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        count += countFilesRecursive(fullPath)
      } else {
        count++
      }
    }
  } catch (e) { console.error("[engine] Failed to count files:", e) }
  return count
}

export const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

export function startStepTimer(): number {
  return performance.now()
}

export function elapsedMs(start: number): number {
  return performance.now() - start
}

export function normalizeToolName(n: string): string {
  return n.replace(/-/g, "_").toLowerCase()
}

export const toolAliases: Record<string, string> = {
  create_file: "write_file",
  make_file: "write_file",
  new_file: "write_file",
  create_directory: "create_folder",
  make_folder: "create_folder",
  remove_file: "delete_file",
  list_files: "list_directory",
  search_code: "search_files",
}

const TOOL_SETS: Record<string, string[]> = {
  create: ["write_file", "create_folder", "read_file", "list_directory", "edit_file", "grep"],
  read:   ["read_file", "list_directory", "grep", "search_files", "search_memories"],
  command: ["execute_command", "read_file", "write_file", "get_errors", "run_tests"],
}

const REQUEST_PATTERNS: Array<{ regex: RegExp; set: string }> = [
  // File creation: "create file", "write to", "make a file", "new file"
  { regex: /create\s+.*file|write\s+.*file|make\s+.*file|new\s+file/i, set: "create" },
  // File edit: "edit", "update", "change", "modify", "add to file"
  { regex: /edit|update|change|modify|add.*file|insert/i, set: "create" },
  // Read tasks: "read", "show", "display", "cat", "what is", "tell me about"
  { regex: /^(?:read|show|display|cat|what|list|find|search) /i, set: "read" },
  // Command tasks: "run", "execute", "install", "build", "test", "npm"
  { regex: /^(?:run|execute|install|build|test|deploy) |npm |npx |yarn /i, set: "command" },
  // Analyze: same as read
  { regex: /analyze|review|investigate|explore|audit/i, set: "read" },
]

export function getToolsForRequest(userMessage: string, allTools: string[]): string[] {
  const trimmed = userMessage.trim()
  if (trimmed.length > 300) return allTools // long messages = complex = all tools

  for (const { regex, set } of REQUEST_PATTERNS) {
    if (regex.test(trimmed)) {
      const subset = TOOL_SETS[set]
      // Always include essential navigation tools
      const essentials = ["read_file", "list_directory", "grep", "search_files"]
      const combined = [...new Set([...subset, ...essentials])]
      // Filter to only include tools that exist in the full registry
      const available = combined.filter((t) => allTools.includes(t))
      if (available.length > 0) return available
    }
  }

  return allTools
}
