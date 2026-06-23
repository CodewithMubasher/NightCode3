import { executeScript } from "../script-executor"
import { WorkspaceSDK } from "../workspace-sdk"

export const executeWorkspaceScriptTool = {
  name: "execute_workspace_script",
  description: `Execute a TypeScript script with direct access to the workspace filesystem.
Use this for multi-step operations: searching, reading, filtering, and modifying files in a single pass.
The script runs locally and returns all results at once.

Write TypeScript code that uses the globally available "workspace" object (type Workspace).

Available workspace API:
- workspace.findFiles(glob: string): Promise<string[]>
  Find files matching a glob pattern (e.g. "src/**/*.ts")
- workspace.readFile(path: string): Promise<string>
  Read entire file contents
- workspace.readFileSection(path, offset, limit): Promise<string>
  Read specific lines (1-based offset)
- workspace.writeFile(path, content): Promise<void>
  Create or overwrite a file
- workspace.patchFile(path, oldString, newString): Promise<boolean>
  Replace exact text in a file (surgical edit)
- workspace.executeCommand(cmd): Promise<{stdout, stderr, exitCode}>
  Run a shell command
- workspace.listDirectory(path): Promise<Array<{name, type, size}>>
  List directory contents

Log progress with console.log(). All logs appear in the response.`,
  schema: { typescript_code: "string" },
  async execute(args: { typescript_code: string }) {
    const logs: string[] = []
    const sdk = new WorkspaceSDK((_type, data: Record<string, unknown>) => {
      if (data.tool && data.status === "verified") {
        logs.push(`[${String(data.tool)}] ${String(data.status)}`)
      }
    })

    const result = await executeScript(args.typescript_code, sdk)

    return {
      success: result.success,
      data: {
        logs: result.logs,
        data: result.data,
      },
      error: result.error,
    }
  },
  async verify(
    _args: { typescript_code: string },
    result: { success: boolean; data?: { logs?: string[] }; error?: string }
  ) {
    if (!result.success) {
      return { verified: false, discrepancy: result.error ?? "Script execution failed" }
    }
    if (!Array.isArray(result.data?.logs)) {
      return { verified: false, discrepancy: "Result logs is not an array" }
    }
    return { verified: true, evidence: { logCount: result.data!.logs!.length } }
  },
}
