import { Annotation, StateGraph, START, END } from "@langchain/langgraph"
import { generateText, tool } from "ai"
import { z } from "zod"
import { getModel } from "../providers"
import { generateId } from "./plan-helpers"
import type { AIProvider } from "@/types"
import * as fs from "fs"
import * as path from "path"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

const WORKSPACE = process.env.BUILD_WORKSPACE || process.cwd()

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(WORKSPACE, filePath)
}

// ─── State ────────────────────────────────────────────────────────────────────

const MessagesAnnotation = Annotation<Array<{ role: string; content: string }>>({
  value: (_, incoming) => incoming,
  default: () => [],
})
const SystemPromptAnnotation = Annotation<string>({
  value: (_, incoming) => incoming,
  default: () => "",
})
const ModelAnnotation = Annotation<string>({
  value: (_, incoming) => incoming,
  default: () => "deepseek-v4-flash-free",
})
const ProviderAnnotation = Annotation<AIProvider>({
  value: (_, incoming) => incoming,
})
const ResponseAnnotation = Annotation<string>({
  value: (_, incoming) => incoming,
  default: () => "",
})

export const BuildState = Annotation.Root({
  messages: MessagesAnnotation,
  systemPrompt: SystemPromptAnnotation,
  model: ModelAnnotation,
  provider: ProviderAnnotation,
  response: ResponseAnnotation,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOnChunk(config: unknown): (chunk: string) => void {
  return (config as Record<string, Record<string, unknown>>)
    ?.configurable?.onChunk as (chunk: string) => void
}

function emit(onChunk: (chunk: string) => void, type: string, data: Record<string, unknown>) {
  onChunk(JSON.stringify({ type, data }))
}

function emitTool(
  onChunk: (chunk: string) => void,
  toolName: string,
  args: Record<string, unknown>,
  status: "running" | "done" | "error",
  result?: string,
  eventId?: string
): string {
  const id = eventId || generateId()
  emit(onChunk, "tool_call", { id, tool: toolName, args, status, result, timestamp: Date.now() })
  return id
}

// ─── Tools ────────────────────────────────────────────────────────────────────

function buildTools(onChunk: (chunk: string) => void) {
  return {
    read_file: tool({
      description: "Read the contents of a file.",
      parameters: z.object({
        path: z.string().describe("File path to read"),
      }),
      execute: async ({ path: filePath }) => {
        const id = emitTool(onChunk, "read_file", { path: filePath }, "running")
        try {
          const content = fs.readFileSync(resolvePath(filePath), "utf-8")
          emitTool(onChunk, "read_file", { path: filePath }, "done", `Read ${content.length} chars`, id)
          return { success: true, content }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          emitTool(onChunk, "read_file", { path: filePath }, "error", msg, id)
          return { success: false, error: msg }
        }
      },
    }),

    write_file: tool({
      description: "Write content to a file. Creates parent directories automatically. Use this to create new files or overwrite existing ones.",
      parameters: z.object({
        path: z.string().describe("File path to write (e.g. 'test-file.txt' or 'src/utils/helper.ts')"),
        content: z.string().describe("Content to write into the file"),
      }),
      execute: async ({ path: filePath, content }) => {
        const id = emitTool(onChunk, "write_file", { path: filePath }, "running")
        try {
          const resolved = resolvePath(filePath)
          // Always ensure parent dir exists — this replaces the need for create_directory
          fs.mkdirSync(path.dirname(resolved), { recursive: true })
          fs.writeFileSync(resolved, content, "utf-8")
          emitTool(onChunk, "write_file", { path: filePath }, "done", `Wrote ${content.length} chars`, id)
          return { success: true, path: filePath, bytes: content.length }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          emitTool(onChunk, "write_file", { path: filePath }, "error", msg, id)
          return { success: false, error: msg }
        }
      },
    }),

    list_directory: tool({
      description: "List files and directories at a path.",
      parameters: z.object({
        path: z.string().describe("Directory path to list").default("."),
      }),
      execute: async ({ path: dirPath }) => {
        const id = emitTool(onChunk, "list_directory", { path: dirPath }, "running")
        try {
          const resolved = resolvePath(dirPath)
          const entries = fs.readdirSync(resolved, { withFileTypes: true })
          const items = entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "dir" : "file",
            size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
          }))
          emitTool(onChunk, "list_directory", { path: dirPath }, "done", `${items.length} entries`, id)
          return { success: true, items }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          emitTool(onChunk, "list_directory", { path: dirPath }, "error", msg, id)
          return { success: false, error: msg }
        }
      },
    }),

    delete_file: tool({
      description: "Delete a file.",
      parameters: z.object({
        path: z.string().describe("File path to delete"),
      }),
      execute: async ({ path: filePath }) => {
        const id = emitTool(onChunk, "delete_file", { path: filePath }, "running")
        try {
          fs.rmSync(resolvePath(filePath))
          emitTool(onChunk, "delete_file", { path: filePath }, "done", "Deleted", id)
          return { success: true }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          emitTool(onChunk, "delete_file", { path: filePath }, "error", msg, id)
          return { success: false, error: msg }
        }
      },
    }),

    execute_command: tool({
      description: "Run a shell command (npm, git, python, etc.) in the workspace.",
      parameters: z.object({
        command: z.string().describe("Shell command to run"),
        cwd: z.string().describe("Working directory (relative to workspace)").default("."),
      }),
      execute: async ({ command, cwd }) => {
        const id = emitTool(onChunk, "execute_command", { command, cwd }, "running")
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: resolvePath(cwd),
            timeout: 30_000,
          })
          const output = [stdout, stderr].filter(Boolean).join("\n").trim()
          emitTool(onChunk, "execute_command", { command }, "done", output.slice(0, 300) || "Done", id)
          return { success: true, stdout, stderr }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          emitTool(onChunk, "execute_command", { command }, "error", msg, id)
          return { success: false, error: msg }
        }
      },
    }),
  }
}

// ─── Graph ────────────────────────────────────────────────────────────────────

export function createBuildGraph() {
  const graph = new StateGraph(BuildState)
    .addNode("build", async (state: typeof BuildState.State, config: unknown) => {
      const onChunk = getOnChunk(config)
      const tools = buildTools(onChunk)

      const systemPrompt = `You are NightCode in Build Mode — an AI agent with real file system and shell access.

CRITICAL RULES — follow these exactly:
1. To create a file: use write_file ONCE. It automatically creates any needed directories. Do NOT call create_directory separately.
2. To create a directory: use write_file with a placeholder file, OR just use write_file for the actual file you want — it handles parent dirs.
3. Never call the same tool twice on the same path unless the first call failed.
4. If a tool returns { success: true }, the operation succeeded — move on.
5. Keep tool calls minimal. One write_file call creates the file. That's it.

Workspace: ${WORKSPACE}
Relative paths resolve from the workspace above.`

      const apiMessages = [
        { role: "system" as const, content: systemPrompt },
        ...state.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ]

      const result = await generateText({
        model: getModel(state.provider, state.model),
        messages: apiMessages,
        tools,
        maxSteps: 5, // tight cap — prevents runaway loops
      })

      const summary = result.text || "Done."
      emit(onChunk, "final", { text: summary })

      return { response: summary }
    })
    .addEdge(START, "build")
    .addEdge("build", END)
    .compile()

  return graph
}
