import type { Message } from "@/types"
import type { ToolImplementation } from "./tools"

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
- Complex problem → use think first to plan your approach.

DEPTH RULE: For investigative tasks (analyze, find bugs, review, audit, explore) — use think first to map out phases, then execute them fully. Only respond when you have read the actual source files and have real evidence. Listing files is not evidence. Reading and understanding file contents is evidence. Cite specific file paths and findings in your response.`

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

export function buildContext(
  messages: Message[],
  systemPrompt: string
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ]

  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content })
  }

  return result
}
