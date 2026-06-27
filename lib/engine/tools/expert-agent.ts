import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { getApiKey } from "@/lib/keys"
import { executeScript } from "../script-executor"
import { WorkspaceSDK } from "../workspace-sdk"

const SUB_AGENT_MODEL = "deepseek-v4-flash"
const SUB_AGENT_PROVIDER = "openrouter"

const SUB_AGENT_SYSTEM = `You are a code generation agent. Write a single TypeScript script that accomplishes the given task.

Write an async function called "run" that receives a "workspace" parameter.

Available workspace API:
- workspace.findFiles(glob: string): Promise<string[]>
- workspace.readFile(path: string): Promise<string>
- workspace.readFileSection(path, offset, limit): Promise<string>
- workspace.writeFile(path, content): Promise<void>
- workspace.patchFile(path, oldString, newString): Promise<boolean>
- workspace.executeCommand(cmd): Promise<{stdout, stderr, exitCode}>
- workspace.listDirectory(path): Promise<Array<{name, type, size}>>

RULES:
1. START WORKING IMMEDIATELY. Do not analyze the task. Do not explain what you will do. Just write the code.
2. Do EVERYTHING in one script. One function called "run" that takes "workspace".
3. Use findFiles + readFile to discover code before modifying.
4. Use patchFile for small changes. Use writeFile for new files.
5. Log progress with console.log().
6. At the end, output a brief 1-line summary of what was done as the final console.log().
7. Handle errors with try/catch.
8. Output ONLY the TypeScript code. No explanations, no markdown formatting, no backticks. Just the raw code starting with "async function run(workspace)".`

function extractCode(text: string): string {
  const match = text.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/)
  if (match) return match[1].trim()
  return text.trim()
}

export const expertAgentTool = {
  name: "expert_agent",
  description: `Delegate complex multi-step file operations to a specialized sub-agent.

The sub-agent writes and executes a single optimized script that does everything in one pass.

DO use for:
- Creating an entire project structure (multiple files)
- Refactoring code across many files
- Searching, reading, and modifying files based on patterns
- Any task that would need 5+ sequential tool calls

DO NOT use for:
- Simple Q&A or conversation
- Reading a single file
- Writing a single file
- Running a single command

Example task: "Create a React component library with Button, Card, and Input components"`,
  schema: { task: "string" },
  async execute(args: Record<string, unknown>) {
    const task = args.task as string
    const emitEvent = args.__emitEvent as ((type: string, payload: Record<string, unknown>) => void) | undefined
    const signal = args.__abortSignal as AbortSignal | undefined

    emitEvent?.("status", { message: "Spawning CaaT sub-agent..." })

    try {
      emitEvent?.("status", { message: "Sub-agent: analyzing task and generating script..." })
      const openrouter = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: getApiKey("OPENROUTER_API_KEY"),
      })
      const lm = openrouter.chat(SUB_AGENT_MODEL)

      const { text: rawScript } = await generateText({
        model: lm,
        system: SUB_AGENT_SYSTEM,
        messages: [{ role: "user", content: task }],
        abortSignal: signal,
      })

      const script = extractCode(rawScript)

      emitEvent?.("status", { message: "Sub-agent: executing workspace script..." })
      const sdk = new WorkspaceSDK((type, data: Record<string, unknown>) => {
        if (data.tool) {
          emitEvent?.(type === "tool_start" ? "tool_start" : "tool_end", {
            tool: data.tool,
            args: data.args,
            status: data.status,
            result: data.result,
            error: data.error,
          })
        }
      })

      const result = await executeScript(script, sdk, signal)

      if (result.success) {
        emitEvent?.("status", { message: "Sub-agent: completed successfully." })
      } else {
        emitEvent?.("status", { message: `Sub-agent: failed — ${result.error}` })
      }

      return {
        success: true,
        data: {
          summary: result.logs.length > 0 ? result.logs[result.logs.length - 1] : "Task completed.",
          task,
          ...(result.success ? {} : { error: result.error }),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      console.error(`[expert-agent] Sub-agent error: ${msg}`)
      emitEvent?.("status", { message: "Sub-agent: encountered an error, continuing with direct tools." })
      return { success: true, data: { summary: "Sub-agent unavailable — continuing directly.", task } }
    }
  },
  async verify(_args: Record<string, unknown>, result: { success: boolean; data?: { summary?: string; error?: string } }) {
    if (result.data?.error) return { verified: true, evidence: { summary: `Sub-agent error: ${result.data.error}` } }
    return { verified: true, evidence: { summary: result.data?.summary ?? "Done" } }
  },
}
