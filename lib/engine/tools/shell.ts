import { spawn } from "child_process"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())
const TIMEOUT_MS = 120_000
const MAX_STDOUT = 50_000
const MAX_STDERR = 20_000

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
  { re: /(^|[\s;&|])del\s+\/[a-z]*f[a-z]*s/i, reason: "Windows force recursive delete" },
  { re: /(^|[\s;&|])rmdir\s+\/s/i, reason: "Windows recursive rmdir" },
  { re: /(^|[\s;&|])rd\s+\/s/i, reason: "Windows recursive rd" },
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

function truncate(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8")
  if (buf.length <= maxBytes) return text
  const cut = buf.subarray(0, maxBytes)
  let end = cut.length
  while (end > 0 && (cut[end - 1] & 0xc0) === 0x80) end--
  return cut.subarray(0, end).toString("utf-8") + `\n\n...[truncated: ${buf.length} total bytes]`
}

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
        CI: "true",
        FORCE_COLOR: "0",
        NODE_ENV: process.env.NODE_ENV,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill("SIGTERM") } catch {}
    }, timeoutMs)

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8")
    })

    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: stderr + `\n[spawn error: ${err.message}]`, exitCode: -1, timedOut })
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut })
    })
  })
}

export const shellTool = {
  name: "shell",
  description: `Execute a shell command in the workspace.

RULES — READ CAREFULLY:
1. Each command runs in a FRESH shell. No persistent state between calls.
2. NEVER use "cd folder" as a standalone command — it does nothing. Use the cwd parameter instead.
3. For commands that ask interactive questions, use flags to skip prompts:
   npx create-vite@latest my-app --template react-ts   (use --template)
   npx shadcn-ui@latest init --yes                      (use --yes)
   npm init -y                                          (use -y)
4. Run setup commands ONE AT A TIME. Verify each succeeded before running the next.
5. Check exit_code in the result: 0 = success, non-zero = FAILED.
6. Long commands (npm install, builds): can take 60-120 seconds.`,
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

    if (!fs.existsSync(cwd)) {
      return { success: false, error: `Directory not found: ${cwd}` }
    }

    const result = await runCommand(trimmed, cwd, TIMEOUT_MS)
    const code = result.exitCode
    const succeeded = code === 0 && !result.timedOut
    const trimmedStdout = truncate(result.stdout, MAX_STDOUT)
    const trimmedStderr = truncate(result.stderr, MAX_STDERR)

    // Build plain-text output like a terminal — the LLM reads this directly
    const outputLines: string[] = []
    outputLines.push(`$ ${trimmed}`)
    outputLines.push(`Working directory: ${cwd}`)
    outputLines.push("")
    if (trimmedStdout) {
      outputLines.push(trimmedStdout)
    }
    if (trimmedStderr) {
      if (trimmedStdout) outputLines.push("")
      outputLines.push("--- stderr ---")
      outputLines.push(trimmedStderr)
    }
    if (result.timedOut) {
      outputLines.push("")
      outputLines.push(`[TIMED OUT after ${TIMEOUT_MS / 1000}s — the command was waiting for input or is too slow. Retry with --yes or --non-interactive flags.]`)
    }
    outputLines.push("")
    outputLines.push(`exit_code: ${code}`)
    outputLines.push(succeeded ? "✓ Command succeeded" : "✗ Command FAILED")
    const output = outputLines.join("\n")

    return {
      success: true,
      data: {
        output,
        command: trimmed,
        cwd,
        stdout: trimmedStdout,
        stderr: trimmedStderr,
        exitCode: code,
        succeeded,
        timedOut: result.timedOut,
      },
    }
  },
  async verify(_args: { command: string }, result: { success: boolean; data?: { exitCode?: number; succeeded?: boolean; timedOut?: boolean; output?: string } }) {
    if (!result.success) {
      return { verified: false, discrepancy: "Tool returned failure" }
    }
    const data = result.data as { exitCode: number; succeeded: boolean; timedOut: boolean; output: string } | undefined
    if (!data) {
      return { verified: false, discrepancy: "No result data" }
    }
    if (data.timedOut) {
      return {
        verified: false,
        evidence: {
          reason: "Command timed out — likely waiting for interactive input",
          fix: "Add --yes, --non-interactive, or CI=true flags to skip prompts",
          exitCode: data.exitCode,
          output: data.output?.slice(0, 500),
        },
      }
    }
    if (!data.succeeded) {
      return {
        verified: false,
        evidence: {
          reason: `Command failed with exit code ${data.exitCode}`,
          output: data.output?.slice(0, 1000),
        },
      }
    }
    return {
      verified: true,
      evidence: { exitCode: data.exitCode, output: data.output?.slice(0, 200) },
    }
  },
}
