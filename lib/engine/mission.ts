import * as path from "path"
import { WORKSPACE } from "./engine-utils"

export interface ExplorationFact {
  path: string
  kind: "file_read" | "dir_listed" | "grep" | "search"
  key: string
}

export class MissionTracker {
  private facts: ExplorationFact[] = []
  private toolCallCount = 0
  private directoriesListed = new Set<string>()
  private filesRead = new Set<string>()
  private rePrompts = 0
  private readonly maxRePrompts = 2

  recordToolCall(toolName: string, args: Record<string, unknown>): void {
    this.toolCallCount++
    if (toolName === "read_file" && typeof args.path === "string") {
      const p = this.normalize(args.path)
      this.filesRead.add(p)
      this.facts.push({ path: p, kind: "file_read", key: `read:${p}` })
    }
    if (toolName === "list_directory" && typeof args.path === "string") {
      const p = this.normalize(args.path)
      this.directoriesListed.add(p)
      this.facts.push({ path: p, kind: "dir_listed", key: `dir:${p}` })
    }
    if ((toolName === "grep" || toolName === "search_files") && typeof args.pattern === "string") {
      this.facts.push({ path: args.pattern, kind: "grep", key: `grep:${args.pattern}` })
    }
  }

  shouldRePrompt(): boolean {
    return this.rePrompts < this.maxRePrompts
  }

  consumeRePrompt(): string | null {
    if (!this.shouldRePrompt()) return null
    this.rePrompts++

    const lines: string[] = ["[SYSTEM: You are in the middle of an analysis mission. You produced a summary but your investigation is incomplete.]"]
    lines.push("")

    const depth = this.facts.length
    if (depth < 2) {
      lines.push("You barely used any tools. Use read_file, list_directory, and grep to explore the codebase.")
      lines.push("Do NOT describe what you'd do — actually do it. Read files, search patterns, and return evidence.")
    } else {
      lines.push("Good start. But there are more areas to explore:")
      if (this.facts.some((f) => f.kind === "dir_listed") && !this.facts.some((f) => f.path.includes("package.json"))) {
        lines.push("  • package.json — read it for dependencies, scripts, and project metadata")
      }
      if (!this.facts.some((f) => f.path.includes("tsconfig") || f.path.includes("next.config"))) {
        lines.push("  • Build configuration (tsconfig.json, next.config.ts) — understand the toolchain")
      }
      if (!this.facts.some((f) => f.path.includes("lib") || f.path.includes("store") || f.path.includes("engine"))) {
        lines.push("  • Core source directories (lib/, store/, components/) — understand architecture")
      }
    }

    lines.push("")
    lines.push("Use your tools. Only produce a final summary after you've thoroughly investigated.")

    return lines.join("\n")
  }

  private normalize(p: string): string {
    const abs = path.isAbsolute(p) ? p : path.resolve(WORKSPACE, p)
    const rel = path.relative(WORKSPACE, abs)
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel
    return abs
  }

  get depth(): number {
    return this.facts.length
  }

  get isDeepEnough(): boolean {
    return this.facts.length >= 5
  }

  reset(): void {
    this.facts = []
    this.toolCallCount = 0
    this.directoriesListed.clear()
    this.filesRead.clear()
    this.rePrompts = 0
  }
}

export function detectExplorationIntent(text: string): boolean {
  if (typeof text !== "string") return false
  const patterns = [
    /analyze/i, /review/i, /explore/i, /investigate/i,
    /understand/i, /tell me about/i, /what.*this.*do/,
    /how.*this.*works/, /codebase overall/i,
    /architecture/i, /structure/i, /summarize/i,
    /overview/i, /give me.*overview/, /what.*in.*this/,
    /read.*codebase/, /examine/i,
  ]
  for (const p of patterns) {
    if (p.test(text)) return true
  }
  return false
}

export function buildExplorationChecklist(text: string): string[] {
  const checklist = [
    "Read package.json — dependencies, scripts, metadata",
    "Identify build system and framework",
    "Examine the source layout (app/, lib/, components/)",
    "Check routing / entry points",
    "Look at the engine or core logic",
    "Check API layer if present",
    "Review state management approach",
  ]
  return checklist
}
