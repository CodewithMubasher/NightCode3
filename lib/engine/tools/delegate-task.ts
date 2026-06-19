import type { ToolImplementation } from "./index"

const SUB_AGENT_TOOLS = [
  "read_file", "write_file", "list_directory", "delete_file", "create_folder",
  "search_files", "execute_command",
  "create_artifact", "list_artifacts", "read_artifact", "edit_artifact",
  "search_memories",
]

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const delegateTaskTool: ToolImplementation = {
  name: "delegate_task",
  description: `Spawn a sub-agent to investigate a specific area and return a structured summary.

The sub-agent has access to all file tools (read, write, search, execute, artifacts).
Use this for large codebase investigations or parallel work.

Choose a specific focus area and list the files/directories to examine.
The sub-agent will work independently and return findings.

Examples:
- Task: "Find all API routes and fix missing error handling" with focus "api" and files ["app/api/"]
- Task: "Audit database queries for N+1 problems" with focus "database" and files ["lib/db/"]
- Task: "Review auth middleware for vulnerabilities" with focus "security" and files ["middleware.ts", "lib/auth/"]`,
  schema: { task: "string", files: "string[]", focus: "string" },
  async execute(args: Record<string, unknown>) {
    const task = (args.task as string) ?? ""
    const rawFiles = args.files as string | string[] ?? []
    const focus = (args.focus as string) ?? "general"
    const depth = (args.__depth as number ?? 0) + 1
    const provider = (args.__provider as string) ?? "opencode"
    const model = (args.__model as string) ?? "big-pickle"

    if (depth >= 2) {
      return {
        success: true,
        data: {
          summary: "Maximum delegation depth reached. Cannot spawn further sub-agents.",
          filesExamined: 0,
          toolCalls: 0,
          focus,
        },
      }
    }

    const files = Array.isArray(rawFiles) ? rawFiles : rawFiles.split(",").map((f: string) => f.trim()).filter(Boolean)

    const { NightCodeEngine } = await import("@/lib/engine")
    const subEngine = new NightCodeEngine()
    const subSignal = new AbortController()
    let capturedText = ""
    let capturedToolCalls: Array<{ tool: string; args: Record<string, unknown> }> = []

    subEngine.subscribe((_event, data: any) => {
      if (data.type === "thinking") {
        capturedText = (data.payload?.text as string) ?? ""
      }
      if (data.type === "tool_start") {
        capturedToolCalls.push({
          tool: data.payload?.tool as string,
          args: data.payload?.args as Record<string, unknown>,
        })
      }
    })

    const focusPrompt = `You are a specialized ${focus} code investigator.
Task: ${task}
Files to examine: ${files.join(", ")}

Focus ONLY on the specified files. You have full access to read, search, write, and execute tools.

Plan:
1. Read the relevant files to understand the code
2. Identify bugs, issues, or improvements
3. Fix any issues you find using write_file
4. Create or update artifacts to document your findings

When done, structure your response like this:

## Summary
Brief overview of what you found and did.

## Findings
- **File:path/to/file.ts** — Description of issue (line X)
- **File:path/to/file.ts** — Description of fix applied

## Changes Made
- path/to/file.ts: what changed

## Confidence
high / medium / low`

    try {
      const messages = [{
        id: `sub_msg_${generateId()}`,
        role: "user" as const,
        content: task,
        toolStates: {},
        artifacts: [],
        status: "complete" as const,
        hasError: false,
      }]
      await subEngine.run(
        messages,
        `sub_${generateId()}`,
        provider as any,
        model,
        subSignal.signal,
        focusPrompt,
        undefined,
        undefined,
        undefined,
        { depth, silent: true, tools: SUB_AGENT_TOOLS }
      )
    } catch (err) {
      capturedText = `Sub-agent error: ${err instanceof Error ? err.message : "Unknown error"}`
    }

    const summary = capturedText || "Sub-agent completed but produced no output."
    const toolCalls = capturedToolCalls.length

    return {
      success: true,
      data: {
        summary,
        filesExamined: files.length,
        toolCalls,
        focus,
      },
    }
  },
  async verify(_args: any, result: any) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    return { verified: true, evidence: { summaryLength: result.data?.summary?.length ?? 0 } }
  },
}
