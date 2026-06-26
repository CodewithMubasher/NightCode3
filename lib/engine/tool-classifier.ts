import type { ToolImplementation } from "./tools"

interface ToolCategory {
  tools: string[]
  keywords: string[]
  patterns: RegExp[]
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    tools: ["read_file", "list_directory", "search_files", "grep"],
    keywords: ["read", "show", "display", "list", "find", "search", "look", "check", "view", "cat", "ls", "dir", "grep", "find", "where"],
    patterns: [/\.(\w+)$/, /file/i, /code/i, /source/i, /directory/i, /folder/i, /path/i],
  },
  {
    tools: ["write_file", "create_folder", "edit_file"],
    keywords: ["create", "write", "build", "make", "generate", "add", "new", "file", "folder", "directory", "edit", "modify", "update", "change"],
    patterns: [/create/i, /write/i, /build/i, /make/i, /generat/i, /edit/i, /modif/i, /updat/i],
  },
  {
    tools: ["execute_command"],
    keywords: ["run", "execute", "command", "shell", "bash", "terminal", "npm", "node", "python", "git", "docker", "build", "test", "lint"],
    patterns: [/run/i, /execut/i, /command/i, /shell/i, /terminal/i, /\bnpm\b/i, /\bnode\b/i, /\bpython\b/i, /\bgit\b/i, /\bdocker\b/i],
  },
  {
    tools: ["grep", "search_files"],
    keywords: ["search", "find", "grep", "regex", "pattern", "match", "where", "locate"],
    patterns: [/search/i, /find/i, /grep/i, /regex/i, /pattern/i, /match/i, /locat/i],
  },
  {
    tools: ["edit_file"],
    keywords: ["fix", "bug", "error", "typo", "rename", "refactor", "replace", "swap", "change"],
    patterns: [/fix/i, /bug/i, /error/i, /typo/i, /renam/i, /refactor/i, /replac/i, /swap/i],
  },
  {
    tools: ["create_artifact", "list_artifacts", "read_artifact", "edit_artifact"],
    keywords: ["plan", "roadmap", "spec", "document", "artifact", "note", "summary", "prd"],
    patterns: [/plan/i, /roadmap/i, /spec/i, /document/i, /artifact/i, /note/i, /summar/i, /\bprd\b/i],
  },
  {
    tools: ["generate_image"],
    keywords: ["image", "picture", "draw", "illustration", "diagram", "visual", "chart", "logo", "icon"],
    patterns: [/image/i, /picture/i, /draw/i, /illustrat/i, /diagram/i, /visual/i, /chart/i, /logo/i, /icon/i],
  },
  {
    tools: ["ask"],
    keywords: ["ask", "question", "clarify", "which", "prefer", "option", "choice"],
    patterns: [/ask/i, /question/i, /clarif/i, /which/i, /prefer/i, /option/i, /choice/i],
  },
  {
    tools: ["search_memories"],
    keywords: ["remember", "memory", "past", "before", "previous", "history", "context"],
    patterns: [/remember/i, /memory/i, /past/i, /before/i, /previous/i, /histor/i, /context/i],
  },
]

const ALWAYS_INCLUDED = new Set(["expert_agent"])

export function classifyTools(
  message: string,
  allTools: ToolImplementation[],
  maxTools = 12
): ToolImplementation[] {
  const lowerMessage = message.toLowerCase()
  const scores = new Map<string, number>()

  for (const tool of allTools) {
    scores.set(tool.name, 0)
  }

  for (const category of TOOL_CATEGORIES) {
    for (const keyword of category.keywords) {
      if (lowerMessage.includes(keyword)) {
        for (const toolName of category.tools) {
          const current = scores.get(toolName) ?? 0
          scores.set(toolName, current + 2)
        }
      }
    }

    for (const pattern of category.patterns) {
      if (pattern.test(message)) {
        for (const toolName of category.tools) {
          const current = scores.get(toolName) ?? 0
          scores.set(toolName, current + 3)
        }
      }
    }
  }

  for (const toolName of ALWAYS_INCLUDED) {
    if (scores.has(toolName)) {
      scores.set(toolName, 100)
    }
  }

  const hasFileExtension = /\.\w{1,4}\b/.test(message)
  if (hasFileExtension) {
    for (const name of ["read_file", "write_file", "edit_file", "grep"]) {
      if (scores.has(name)) {
        const current = scores.get(name) ?? 0
        scores.set(name, current + 5)
      }
    }
  }

  const hasCodeBlock = /```[\s\S]*```/.test(message)
  if (hasCodeBlock) {
    for (const name of ["write_file", "edit_file"]) {
      if (scores.has(name)) {
        const current = scores.get(name) ?? 0
        scores.set(name, current + 4)
      }
    }
  }

  const sorted = allTools
    .map((t) => ({ tool: t, score: scores.get(t.name) ?? 0 }))
    .sort((a, b) => b.score - a.score)

  const selected: ToolImplementation[] = []
  for (const { tool, score } of sorted) {
    if (selected.length >= maxTools) break
    if (score > 0 || ALWAYS_INCLUDED.has(tool.name)) {
      selected.push(tool)
    }
  }

  if (selected.length < 4) {
    const fallback = allTools.filter((t) =>
      ["read_file", "write_file", "grep", "execute_command"].includes(t.name)
    )
    for (const t of fallback) {
      if (!selected.find((s) => s.name === t.name)) {
        selected.push(t)
      }
    }
  }

  return selected
}

export function getToolCategory(toolName: string): string {
  for (const category of TOOL_CATEGORIES) {
    if (category.tools.includes(toolName)) {
      return category.keywords[0]
    }
  }
  return "general"
}
