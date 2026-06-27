import { spawn } from "child_process"
import * as path from "path"
import * as os from "os"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())
const TIMEOUT_MS = 120_000
const MAX_BUFFER = 10 * 1024 * 1024 // 10MB — npm/git output can be large

// Dangerous patterns block destructive commands while still allowing normal dev work.
const DANGEROUS_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /(^|[\s;&|`])rm\s+-[a-zA-Z]*r[a-zA-Z]*f/, reason: "recursive forced delete (rm -rf)" },
  { re: /(^|[\s;&|`])rm\s+-[a-zA-Z]*f[a-zA-Z]*r/, reason: "recursive forced delete (rm -rf)" },
  { re: /rm\s+(?:-rf\s+)?[\\/]\s*$/, reason: "rm of root directory" },
  { re: /rm\s+-[a-zA-Z]*\s+(?:~|\/home|\/Users|\$HOME)\b/, reason: "rm of home directory" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, reason: "fork bomb" },
  { re: /\bmkfs\b/, reason: "filesystem format" },
  { re: /\bdd\b.*\bof=\/dev\//, reason: "dd to a device" },
  { re: /(^|[\s;&|])shred\b/, reason: "shred (secure delete)" },
  { re: /\bformat\s+[a-z]:/i, reason: "Windows format drive" },
  { re: /(^|[\s;&|])del\s+\/[a-z]*f[a-z]*s/i, reason: "Windows force recursive delete (del /f /s)" },
  { re: /(^|[\s;&|])rmdir\s+\/s/i, reason: "Windows recursive rmdir (rmdir /s)" },
  { re: /(^|[\s;&|])rd\s+\/s/i, reason: "Windows recursive rd (rd /s)" },
  { re: /^\s*>\s*[\\/]/, reason: "redirect to root path" },
  { re: /\\(?:[a-zA-Z0-9_-]+)/, reason: "UNC path" },
  { re: /\bchmod\s+-R?\s*0?777\s+\//, reason: "chmod 777 on root" },
  { re: /\bcurl\b.*\|\s*(?:sh|bash|zsh)\b/, reason: "curl piped to shell" },
  { re: /\bwget\b.*\|\s*(?:sh|bash|zsh)\b/, reason: "wget piped to shell" },
  { re: /--no-preserve-root/, reason: "bypass rm root protection" },
]

function validateCommand(command: string): void {
  for (const { re, reason } of DANGEROUS_PATTERNS) {
    if (re.test(command)) {
      throw new Error(`Security policy blocked this command (${reason}). Refusing to run: ${command.slice(0, 120)}`)
    }
  }
}

function resolveCwd(dirPath: string): string {
  const resolved = path.isAbsolute(dirPath) ? dirPath : path.resolve(WORKSPACE, dirPath)
  const normalized = path.normalize(resolved)
  if (!normalized.toLowerCase().startsWith(WORKSPACE.toLowerCase())) {
    throw new Error(`Working directory "${dirPath}" is outside the workspace`)
  }
  return normalized
}

// Run a command via spawn so we capture stdout AND stderr even on non-zero exit,
// and so we can stream partial output. Node's exec() throws on non-zero exit,
// hiding the very compiler/test output the agent needs to debug.
function runCommand(command: string, cwd: string, timeoutMs: number): Promise<{
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}> {
  return new Promise((resolve) => {
    const isWin = os.platform() === "win32"
    const shell = isWin ? process.env.ComSpec || "cmd.exe" : "/bin/sh"
    const shellFlag = isWin ? "/c" : "-c"
    const child = spawn(shell, [shellFlag, command], {
      cwd,
      env: {
        ...process.env,
        // Ensure PATH is inherited so npm/node/git resolve.
        NODE_ENV: process.env.NODE_ENV,
      },
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let cappedStdout = false
    let cappedStderr = false

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill("SIGKILL") } catch {}
    }, timeoutMs)

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_BUFFER) {
        const room = MAX_BUFFER - stdout.length
        stdout += chunk.toString("utf-8", 0, Math.min(chunk.length, room))
        if (chunk.length > room) cappedStdout = true
      }
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_BUFFER) {
        const room = MAX_BUFFER - stderr.length
        stderr += chunk.toString("utf-8", 0, Math.min(chunk.length, room))
        if (chunk.length > room) cappedStderr = true
      }
    })

    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: stderr + `\n[spawn error: ${err.message}]`,
        exitCode: -1,
        timedOut,
      })
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      if (cappedStdout) stdout += "\n... [stdout truncated at 10MB]"
      if (cappedStderr) stderr += "\n... [stderr truncated at 10MB]"
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        timedOut,
      })
    })
  })
}

export const executeCommandTool = {
  name: "execute_command",
  description: "Run a shell command in the workspace (npm, npx, git, tsc, eslint, python, cargo, etc.). Captures stdout, stderr, and exit code. 120 second timeout, 10MB output cap. Use ONE command per call. Blocked: rm -rf, fork bombs, mkfs, dd to devices, curl|sh, format, and similar destructive operations. The working directory defaults to the workspace root.",
  schema: { command: "string", cwd: "string?" },
  async execute(args: { command: string; cwd?: string }) {
    const trimmed = (args.command ?? "").trim()
    if (!trimmed) {
      return { success: false, error: "No command provided." }
    }
    try {
      validateCommand(trimmed)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Command blocked" }
    }

    let cwd: string
    try {
      cwd = resolveCwd(args.cwd ?? ".")
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Invalid cwd" }
    }

    const result = await runCommand(trimmed, cwd, TIMEOUT_MS)

    // We always return success:true with the real exit code in data — the verifier
    // decides whether a non-zero exit counts as a tool failure. This preserves the
    // stdout/stderr the agent needs to debug compiler/test failures.
    const data: Record<string, unknown> = {
      command: trimmed,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    }
    if (result.timedOut) {
      data.note = `Command exceeded ${TIMEOUT_MS / 1000}s and was killed. Partial output shown above.`
    }
    return { success: true, data }
  },
  async verify(_args: { command: string }, result: { success: boolean; data?: { exitCode?: number; stderr?: string; timedOut?: boolean } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    // Non-zero exit is "verified" from a tool-execution standpoint (the command ran),
    // but we surface the exit code in evidence so the LLM sees it failed.
    return {
      verified: true,
      evidence: {
        exitCode: result.data?.exitCode,
        timedOut: result.data?.timedOut,
      },
    }
  },
}
