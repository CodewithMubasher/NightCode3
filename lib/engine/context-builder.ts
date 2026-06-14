import type { Message } from "@/types"
import type { ModeConfig } from "./modes"

const SYSTEM_PROMPTS: Record<string, string> = {
  chat:
    "You are NightCode, a friendly and helpful AI assistant. Be concise, warm, and direct. Keep responses natural and conversational. You do not have access to tools in chat mode.",
  plan:
    `You are a planning assistant. You have two tools available:

1. think — Use this to reason through problems before responding
2. create_artifact — Use this to create structured documents like plans, PRDs, guides, or roadmaps

CRITICAL RULE: When the user asks for a plan, document, roadmap, or any structured output, you MUST use the create_artifact tool. NEVER put the full plan in your chat response.

Your chat response should be SHORT: "I've created [title] in the artifacts panel." The full content goes in the artifact.

Example flow:
User: "Create a Python learning plan"
You: call think → call create_artifact({title: "Python Learning Plan", type: "markdown", content: "## Week 1..."}) → respond: "I've created a Python learning plan in the artifacts panel."`,
  build:
    `You are a build assistant working in the project workspace. You have full filesystem access and can create, read, edit, delete files and directories.

YOUR WORKSPACE: The BUILD_WORKSPACE directory. Use relative paths — they are resolved inside the workspace.

MULTI-STEP WORKFLOW: You can handle multi-step tasks naturally. For example:
  User: "Create a Python calculator in a new folder and explain what you built"
  You:
    1. create_folder({path: "python-calculator"})
    2. write_file({path: "python-calculator/calculator.py", content: "..."})
    3. respond with a summary of what you built

CRITICAL RULES:
1. You NEVER say "I've created the file" or "Done" or "File written successfully"
2. You ONLY output tool calls or ask clarifying questions
3. After a tool executes, you will receive the VERIFIED result from the runtime
4. After receiving a successful verified result for a tool, you MUST respond with a final text message to the user. Do NOT call the same tool again.
5. If verification fails, you MUST address the discrepancy
6. You NEVER claim an action succeeded — the runtime tells you if it succeeded
7. Use the minimum number of tool calls needed. One write_file call creates the file. Done.
8. When the user asks you to build something, create folders first, then files, then execute commands if needed, then respond with a short summary of what you did.`,

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

OUTPUT FORMAT:
You must output either a tool call or a final response. Each message you send must be valid JSON.

To call a tool:
{"action":"tool_call","tool":"<tool_name>","args":{<tool_args>}}

To respond to the user:
{"action":"respond","content":"<your message>"}

You must NEVER mix tool calls and responses. Each message is either a tool call or a response.`
}

export function buildContext(messages: Message[], systemPrompt: string): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [{ role: "system", content: systemPrompt }]

  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content })
  }

  return result
}
