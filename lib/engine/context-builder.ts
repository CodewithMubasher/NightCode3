import type { Message } from "@/types"
import type { ModeConfig } from "./modes"

const SYSTEM_PROMPTS: Record<string, string> = {
  chat:
    "You are NightCode, a friendly and helpful AI assistant. Be concise, warm, and direct. Keep responses natural and conversational. You do not have access to tools in chat mode.",
  plan:
    `You are a planning assistant. You have two tools:

1. think — Use to reason through complex problems
2. create_artifact — Use ONLY when the user asks for a structured document (plan, roadmap, guide, PRD, spec, documentation)

DEFAULT BEHAVIOR: For simple questions ("What is X?", "How does Y work?", "Explain Z"), respond directly with text. Do NOT use tools.

USE TOOLS ONLY WHEN:
- User asks for a plan, roadmap, or structured document → use create_artifact
- Problem requires step-by-step reasoning → use think, then respond or create artifact

EXAMPLES:
"What is JavaScript?" → respond directly
"Create a JavaScript learning roadmap" → think → create_artifact → respond
"Explain closures" → think → respond (no artifact needed)
"Write a PRD for a todo app" → think → create_artifact → respond`,
  build:
    `You are a build assistant. All paths are relative to the workspace directory. Create folders first, then files. Execute ALL tools needed before responding. After completing everything, respond with a short summary.`,

}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_file: "Read the contents of a file. Returns the file content or an error.",
  write_file: "Write content to a file. Creates parent directories automatically.",
  list_directory: "List files and directories at a path.",
  delete_file: "Delete a file or directory (recursively).",
  create_folder: "Create a new directory. Creates parent directories automatically.",
  search_files: "Search for files matching a glob pattern (e.g. '**/*.py', 'src/**/*.ts'). Returns relative paths.",
  execute_command: "Run a shell command (npm, git, python, etc.) in the workspace. 30 second timeout.",
  think: "Use this tool to reason through a problem, organize your thoughts, or plan your approach before responding. No actual side effects.",
  create_artifact: "Create a structured artifact document (plan, PRD, docs, guide). The artifact appears in the right panel for the user to view, download, or copy.",
}

export interface ContextResult {
  messages: Array<{ role: string; content: string }>
  toolInstructions: string
}

export function buildSystemPrompt(mode: string, config: ModeConfig): string {
  const base = SYSTEM_PROMPTS[mode] ?? SYSTEM_PROMPTS.chat

  if (config.tools.length === 0) return base

  const toolList = config.tools
    .map((t) => {
      const desc = TOOL_DESCRIPTIONS[t.name] ?? t.name
      return `- ${t.name}: ${desc}`
    })
    .join("\n")

  return `${base}

AVAILABLE TOOLS:
${toolList}

OUTPUT FORMAT — YOU MUST USE EXACTLY THIS FORMAT:

To call a tool:
{"action":"tool_call","tool":"<tool_name>","args":{<tool_args>}}

To respond:
{"action":"respond","content":"<your message>"}

DO NOT use the tool name as the action. The action MUST be "tool_call" or "respond".
DO NOT stop after one tool. Execute ALL tools the user requested before responding.`
}

export function buildContext(messages: Message[], systemPrompt: string): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [{ role: "system", content: systemPrompt }]

  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content })
  }

  return result
}
