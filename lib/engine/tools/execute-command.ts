import { exec } from "child_process"
import { promisify } from "util"
import * as path from "path"

const execAsync = promisify(exec)
const WORKSPACE = process.env.BUILD_WORKSPACE || process.cwd()

function resolvePath(dirPath: string): string {
  if (path.isAbsolute(dirPath)) return dirPath
  return path.resolve(WORKSPACE, dirPath)
}

export const executeCommandTool = {
  name: "execute_command",
  description: "Run a shell command (npm, git, python, etc.) in the workspace. 30 second timeout.",
  schema: { command: "string", cwd: "string" },
  async execute(args: { command: string; cwd?: string }) {
    const cwd = resolvePath(args.cwd ?? ".")
    const { stdout, stderr } = await execAsync(args.command, { cwd, timeout: 30_000 })
    return {
      success: true,
      data: { command: args.command, stdout, stderr, exitCode: 0 },
    }
  },
  async verify(_args: { command: string }, result: { success: boolean; data?: { exitCode?: number; stderr?: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (result.data?.exitCode !== 0 && result.data?.exitCode !== undefined) {
      return {
        verified: false,
        discrepancy: `Command exited with code ${result.data.exitCode}: ${result.data.stderr ?? ""}`,
      }
    }
    return { verified: true, evidence: { exitCode: 0 } }
  },
}
