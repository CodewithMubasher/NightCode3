import type { ToolImplementation } from "./tools"

// ─── Tag definitions ─────────────────────────────────────────────────────────
interface ToolTag {
  tags: string[]           // direct-match keywords
  synonyms: string[]       // weaker-match keywords
  category: string         // capability group
  essential: boolean       // always include
}

const BUILTIN_TAGS: Record<string, ToolTag> = {
  read_file: {
    tags: ["read", "show", "display", "cat", "view", "open", "get", "check", "see"],
    synonyms: ["look", "examine", "inspect", "review", "peek", "load", "fetch", "reveal", "dump", "print"],
    category: "filesystem",
    essential: false,
  },
  write_file: {
    tags: ["create", "write", "make", "new", "add file", "generate", "save", "output", "produce"],
    synonyms: ["build", "construct", "scaffold", "bootstrap", "init", "setup"],
    category: "filesystem",
    essential: false,
  },
  edit_file: {
    tags: ["edit", "change", "update", "modify", "fix", "patch", "replace", "rename", "adjust", "alter"],
    synonyms: ["tweak", "correct", "amend", "rewrite", "refactor", "improve", "transform"],
    category: "filesystem",
    essential: false,
  },
  list_directory: {
    tags: ["list", "ls", "dir", "contents", "files in", "what's in", "show folder", "browse"],
    synonyms: ["enumerate", "explore", "navigate", "scan", "index"],
    category: "filesystem",
    essential: false,
  },
  delete_file: {
    tags: ["delete", "remove", "rm", "trash", "clean", "erase", "clear"],
    synonyms: ["destroy", "eliminate", "discard", "purge", "wipe"],
    category: "filesystem",
    essential: false,
  },
  create_folder: {
    tags: ["create folder", "mkdir", "make directory", "new folder", "new directory"],
    synonyms: ["organize", "structure", "arrange"],
    category: "filesystem",
    essential: false,
  },
  search_files: {
    tags: ["search", "find", "locate", "where is", "look for", "hunt", "seek", "discover"],
    synonyms: ["query", "scan for", "track down", "uncover", "detect", "retrieve"],
    category: "filesystem",
    essential: false,
  },
  grep: {
    tags: ["grep", "search", "pattern", "find text", "search code", "search in"],
    synonyms: ["match", "occurrence", "contains", "includes", "filter"],
    category: "filesystem",
    essential: false,
  },
  shell: {
    tags: ["run", "execute", "command", "shell", "terminal", "npm", "npx", "yarn", "pnpm", "pip", "node", "python", "bash", "cmd", "powershell", "install", "build", "test", "deploy", "compile", "start", "dev", "serve"],
    synonyms: ["launch", "invoke", "trigger", "perform", "do", "process", "script", "task"],
    category: "system",
    essential: false,
  },
  get_errors: {
    tags: ["error", "bug", "issue", "problem", "fail", "crash", "broken", "wrong", "fix"],
    synonyms: ["diagnose", "troubleshoot", "debug", "resolve", "repair"],
    category: "system",
    essential: false,
  },
  run_tests: {
    tags: ["test", "spec", "unit test", "integration test", "e2e", "coverage", "assert"],
    synonyms: ["validate", "verify", "check", "confirm", "ensure", "qa"],
    category: "system",
    essential: false,
  },
  create_artifact: {
    tags: ["artifact", "create plan", "create doc", "create spec", "create design", "roadmap", "prd", "guide", "tutorial", "architecture"],
    synonyms: ["blueprint", "diagram", "overview", "summary", "documentation", "writeup"],
    category: "knowledge",
    essential: false,
  },
  list_artifacts: {
    tags: ["list artifacts", "show artifacts", "my artifacts", "saved docs"],
    synonyms: ["index artifacts", "enumerate artifacts"],
    category: "knowledge",
    essential: false,
  },
  read_artifact: {
    tags: ["read artifact", "open artifact", "show artifact", "view artifact"],
    synonyms: ["load artifact", "fetch artifact", "retrieve artifact"],
    category: "knowledge",
    essential: false,
  },
  edit_artifact: {
    tags: ["edit artifact", "update artifact", "change artifact", "modify artifact"],
    synonyms: ["revise artifact", "amend artifact", "rewrite artifact"],
    category: "knowledge",
    essential: false,
  },
  search_memories: {
    tags: ["memory", "remember", "history", "past", "what did", "before", "context", "search memories"],
    synonyms: ["recall", "recollect", "previous", "prior", "earlier"],
    category: "knowledge",
    essential: false,
  },
  generate_image: {
    tags: ["image", "picture", "photo", "draw", "generate image", "create image", "visual", "illustration", "art", "design", "icon", "logo", "banner", "diagram", "chart"],
    synonyms: ["render", "produce image", "make image", "paint", "sketch", "create visual"],
    category: "media",
    essential: false,
  },
  delegate_task: {
    tags: ["subtask", "delegate", "spawn", "another agent", "research separately"],
    synonyms: ["parallel", "separate", "background", "independent"],
    category: "meta",
    essential: false,
  },
  ask: {
    tags: [],
    synonyms: [],
    category: "meta",
    essential: true,
  },
  task: {
    tags: [],
    synonyms: [],
    category: "meta",
    essential: true,
  },
  plan_exit: {
    tags: [],
    synonyms: [],
    category: "meta",
    essential: false,
  },
}

// MCP prefix → capability mapping
const MCP_CATEGORIES: Record<string, ToolTag> = {
  win_control_mcp: {
    tags: ["desktop", "mouse", "click", "keyboard", "type", "screenshot", "app", "window", "notepad", "calculator", "browser", "open app", "press", "hotkey"],
    synonyms: ["screen", "ui", "automation", "control", "input", "launch"],
    category: "desktop",
    essential: false,
  },
  gmail_mcp: {
    tags: ["email", "gmail", "mail", "inbox", "send email", "read email", "compose", "message", "outlook", "inbox"],
    synonyms: ["correspondence", "communication", "draft", "reply", "forward", "unread"],
    category: "gmail",
    essential: false,
  },
  excel_mcp: {
    tags: ["excel", "spreadsheet", "sheet", "xlsx", "workbook", "cell", "table", "data", "csv", "column", "row", "chart"],
    synonyms: ["grid", "numbers", "tabular", "pivot", "formula", "worksheet"],
    category: "excel",
    essential: false,
  },
  ms_office_mcp_word: {
    tags: ["word", "document", "docx", "report", "letter", "resume", "cv", "write doc", "office"],
    synonyms: ["manuscript", "paper", "file", "memo", "article", "proposal"],
    category: "word",
    essential: false,
  },
  playwright_browser: {
    tags: ["browser", "webpage", "website", "url", "click", "navigate", "form", "login", "scrape", "web", "html", "page", "link", "button"],
    synonyms: ["site", "online", "http", "internet", "web automation", "test webpage"],
    category: "browser",
    essential: false,
  },
  obsidian_mcp: {
    tags: ["obsidian", "note", "vault", "markdown", "wiki", "knowledge base", "personal wiki"],
    synonyms: ["journal", "brain", "second brain", "note-taking", "document"],
    category: "obsidian",
    essential: false,
  },
}

const MCP_PREFIX_ORDER = [
  "win_control_mcp",
  "ms_office_mcp_word",
  "playwright_browser",
  "gmail_mcp",
  "excel_mcp",
  "obsidian_mcp",
]

function findMcpCategory(toolName: string): ToolTag | null {
  const normal = toolName.replace(/-/g, "_")
  for (const prefix of MCP_PREFIX_ORDER) {
    if (normal.startsWith(prefix)) return MCP_CATEGORIES[prefix]
  }
  return null
}

// ─── Scorer ──────────────────────────────────────────────────────────────────

interface ScoredCapability {
  category: string
  score: number
  matchedKeywords: string[]
  toolNames: string[]
}

export interface ToolCapabilityLog {
  userMessage: string
  capabilities: ScoredCapability[]
  loadedTools: string[]
  usedTools: string[]
  unusedTools: string[]
}

export function scoreCapabilities(
  userText: string,
  previousToolNames: string[],
  allToolNames: string[],
): ScoredCapability[] {
  const text = userText.toLowerCase().trim()
  const rawWords = text.split(/\s+/)
  const words = new Set(rawWords.map((w) => w.replace(/[^a-z0-9]/g, "")))

  const categoryScores = new Map<string, ScoredCapability>()

  function addTool(cat: string, toolName: string, tag: ToolTag, score: number, matched: string[]) {
    const existing = categoryScores.get(cat)
    if (existing) {
      existing.score += score
      for (const k of matched) {
        if (!existing.matchedKeywords.includes(k)) existing.matchedKeywords.push(k)
      }
      if (!existing.toolNames.includes(toolName)) existing.toolNames.push(toolName)
    } else {
      categoryScores.set(cat, {
        category: cat,
        score,
        matchedKeywords: [...matched],
        toolNames: [toolName],
      })
    }
  }

  for (const toolName of allToolNames) {
    const tag = BUILTIN_TAGS[toolName] ?? findMcpCategory(toolName)
    if (!tag) continue
    if (tag.essential) {
      // Essential tools are always included later; skip scoring
      continue
    }

    let score = 0
    const matched: string[] = []

    // Direct keyword match: +3 each
    for (const kw of tag.tags) {
      if (kw.includes(" ")) {
        // Multi-word phrase
        if (text.includes(kw)) {
          score += 3
          matched.push(kw)
        }
      } else {
        if (words.has(kw)) {
          score += 3
          matched.push(kw)
        } else if (kw.length >= 3) {
          // Fuzzy: check if any word starts with the keyword (handles plurals: "mails" → "mail")
          for (const w of words) {
            if (w.startsWith(kw) && w.length > kw.length) {
              score += 3
              matched.push(`${kw}→${w}`)
              break
            }
          }
        }
      }
    }

    // Synonym match: +2 each (also fuzzy for synonyms ≥ 4 chars)
    for (const syn of tag.synonyms) {
      if (words.has(syn)) {
        score += 2
        matched.push(syn)
      } else if (syn.length >= 4) {
        for (const w of words) {
          if (w.startsWith(syn)) {
            score += 2
            matched.push(`${syn}→${w}`)
            break
          }
        }
      }
    }

    // Previous tool bias: +1 if used in last 3 steps
    if (previousToolNames.includes(toolName)) {
      score += 1
    }

    if (score > 0) {
      addTool(tag.category, toolName, tag, score, matched)
    }
  }

  // Sort by score descending
  const sorted = [...categoryScores.values()].sort((a, b) => b.score - a.score)
  return sorted
}

// ─── Tool selector ───────────────────────────────────────────────────────────

export function selectTools(
  userText: string,
  previousToolNames: string[],
  allToolImplementations: ToolImplementation[],
): { tools: ToolImplementation[]; log: ToolCapabilityLog } {
  const allNames = allToolImplementations.map((t) => t.name)
  const capabilities = scoreCapabilities(userText, previousToolNames, allNames)

  const selected = new Set<string>()

  // Always include essential tools
  for (const [name, tag] of Object.entries(BUILTIN_TAGS)) {
    if (tag.essential && allNames.includes(name)) {
      selected.add(name)
    }
  }

  // Include tools from scored capabilities (threshold: score >= 2)
  for (const cap of capabilities) {
    if (cap.score >= 2) {
      for (const toolName of cap.toolNames) {
        selected.add(toolName)
      }
    }
  }

  // Resolve tool implementations
  const tools = allToolImplementations.filter((t) => selected.has(t.name))
  const loadedNames = tools.map((t) => t.name)

  return {
    tools,
    log: {
      userMessage: userText,
      capabilities,
      loadedTools: loadedNames,
      usedTools: [],
      unusedTools: [],
    },
  }
}

// ─── Escape hatch ────────────────────────────────────────────────────────────

const ESCAPE_HATCH_RE = /\{\s*"request_capability"\s*:\s*"([^"]+)"\s*\}/

export function parseEscapeHatch(text: string): string | null {
  const match = text.match(ESCAPE_HATCH_RE)
  return match ? match[1] : null
}

// Map capability name → tool names that provide it
const CAPABILITY_TOOLS: Record<string, string[]> = {
  editing: ["edit_file", "write_file", "delete_file", "create_folder"],
  filesystem: ["read_file", "write_file", "edit_file", "list_directory", "delete_file", "create_folder", "search_files", "grep"],
  desktop: ["win_control_mcp_take_screenshot", "win_control_mcp_open_app", "win_control_mcp_hotkey", "win_control_mcp_press_key", "win_control_mcp_write_text", "win_control_mcp_open_url", "win_control_mcp_get_mouse_position"],
  gmail: ["gmail_mcp_gmail_send", "gmail_mcp_gmail_inbox", "gmail_mcp_gmail_unread", "gmail_mcp_gmail_search", "gmail_mcp_gmail_read_body", "gmail_mcp_gmail_mark_read", "gmail_mcp_gmail_reply", "gmail_mcp_gmail_trash", "gmail_mcp_gmail_download_attachments"],
  excel: ["excel_mcp_excel_create_workbook", "excel_mcp_excel_write_cell", "excel_mcp_excel_write_range", "excel_mcp_excel_read_cell", "excel_mcp_excel_read_range", "excel_mcp_excel_create_chart", "excel_mcp_excel_add_sheet"],
  word: ["ms_office_mcp_word_create_blank", "ms_office_mcp_word_add_paragraph", "ms_office_mcp_word_add_table", "ms_office_mcp_word_add_heading"],
  browser: ["playwright_browser_navigate", "playwright_browser_click", "playwright_browser_type", "playwright_browser_snapshot", "playwright_browser_take_screenshot", "playwright_browser_fill_form"],
  obsidian: ["obsidian_mcp_read_note", "obsidian_mcp_write_note", "obsidian_mcp_search_notes", "obsidian_mcp_list_notes"],
  command: ["shell", "run_tests", "get_errors"],
  media: ["generate_image"],
  knowledge: ["create_artifact", "list_artifacts", "read_artifact", "edit_artifact", "search_memories"],
}

export function getToolsForCapability(
  capability: string,
  allImplementations: ToolImplementation[],
): ToolImplementation[] {
  const names = CAPABILITY_TOOLS[capability]
  if (!names) return []
  const nameSet = new Set(names)
  return allImplementations.filter((t) => nameSet.has(t.name))
}
