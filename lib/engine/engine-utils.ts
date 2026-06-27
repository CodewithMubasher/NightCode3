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
        if (p.type === "tool-result") return acc + 20
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
      if (typeof val === "string" && val.length > CLEAR_THRESHOLD_TOKENS) {
        part.output = { type: "json" as const, value: `[Tool result processed: ${toolName}]` }
        cleared++
      } else if (typeof val === "object" && val !== null) {
        const str = JSON.stringify(val)
        if (str.length > CLEAR_THRESHOLD_TOKENS) {
          part.output = { type: "json" as const, value: `[Tool result processed: ${toolName}]` }
          cleared++
        }
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
