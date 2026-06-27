import { spawn } from "child_process"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function runQuick(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32"
    const shell = isWin ? (process.env.ComSpec || "cmd.exe") : "/bin/sh"
    const child = spawn(shell, [isWin ? "/c" : "-c", command], { cwd, windowsHide: true })
    let out = ""
    child.stdout?.on("data", (c: Buffer) => { out += c.toString("utf-8") })
    child.stderr?.on("data", (c: Buffer) => { out += c.toString("utf-8") })
    child.on("close", () => resolve(out))
    child.on("error", () => resolve(""))
    setTimeout(() => { try { child.kill() } catch {} resolve(out) }, 30_000)
  })
}

interface LintError {
  file: string
  line?: number
  col?: number
  message: string
  source?: string
}

function parseTscOutput(raw: string): LintError[] {
  const errors: LintError[] = []
  const re = /^(.+?)(?:\((\d+)(?:,(\d+))?\))?\s*:\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    errors.push({
      file: m[1].trim(),
      line: m[2] ? parseInt(m[2]) : undefined,
      col: m[3] ? parseInt(m[3]) : undefined,
      message: `[${m[4]}] ${m[5]} (${m[6]})`,
      source: "tsc",
    })
  }
  return errors
}

function parseEslintOutput(raw: string): LintError[] {
  const errors: LintError[] = []
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+)$/)
    if (m) {
      errors.push({
        file: m[1].trim(),
        line: parseInt(m[2]),
        col: parseInt(m[3]),
        message: `[${m[4]}] ${m[5]}`,
        source: "eslint",
      })
    }
  }
  return errors
}

export const getErrorsTool = {
  name: "get_errors",
  description: "Run TypeScript type-check (tsc --noEmit) and optionally ESLint in the workspace, parse errors into a structured list. Use this AFTER making code changes to verify correctness. Returns up to 30 errors with file, line, column, and message. Runs tsc first (always), then eslint if an eslint config is present.",
  schema: { include_eslint: "boolean?" },
  async execute(args: { include_eslint?: boolean }): Promise<{ success: boolean; data?: { errors: LintError[]; sources: string[] }; error?: string }> {
    const cwd = WORKSPACE
    const errors: LintError[] = []
    const sources: string[] = []

    // TypeScript
    try {
      const tscOut = await runQuick("npx tsc --noEmit 2>&1 || true", cwd)
      const tscErrors = parseTscOutput(tscOut)
      if (tscErrors.length > 0) {
        errors.push(...tscErrors)
        sources.push(`tsc (${tscErrors.length} errors)`)
      }
    } catch (err) {
      errors.push({ file: "", message: `tsc failed: ${err instanceof Error ? err.message : "unknown"}`, source: "tsc" })
    }

    // ESLint (only if config exists)
    if (args.include_eslint !== false) {
      const hasEslint = [
        "eslint.config.js", "eslint.config.mjs", "eslint.config.ts",
        ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", ".eslintrc",
      ].some((f) => path.join(cwd, f))
      if (hasEslint) {
        try {
          const esOut = await runQuick("npx eslint . --format json 2>&1 || true", cwd)
          // Try JSON parse first, fall back to line-by-line
          try {
            const parsed = JSON.parse(esOut)
            for (const file of parsed ?? []) {
              for (const msg of file.messages ?? []) {
                errors.push({
                  file: file.filePath?.replace(cwd + path.sep, "").replace(cwd + "/", "") ?? "",
                  line: msg.line,
                  col: msg.column,
                  message: `[${msg.severity === 2 ? "error" : "warn"}] ${msg.message} (${msg.ruleId ?? ""})`,
                  source: "eslint",
                })
              }
            }
          } catch {
            const eslintErrors = parseEslintOutput(esOut)
            if (eslintErrors.length > 0) errors.push(...eslintErrors)
          }
          const esCount = errors.filter((e) => e.source === "eslint").length
          if (esCount > 0) sources.push(`eslint (${esCount} errors)`)
        } catch (err) {
          errors.push({ file: "", message: `eslint failed: ${err instanceof Error ? err.message : "unknown"}`, source: "eslint" })
        }
      }
    }

    return {
      success: true,
      data: {
        errors: errors.slice(0, 30),
        sources,
      },
    }
  },
  async verify(_args: Record<string, unknown>, result: { success: boolean; data?: { errors: unknown[] } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    return { verified: true, evidence: { errorCount: result.data?.errors?.length ?? 0 } }
  },
}
