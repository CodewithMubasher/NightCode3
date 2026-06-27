import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())
const TIMEOUT_MS = 60_000

function runCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32"
    const shell = isWin ? (process.env.ComSpec || "cmd.exe") : "/bin/sh"
    const child = spawn(shell, [isWin ? "/c" : "-c", command], { cwd, windowsHide: true })
    let stdout = "", stderr = ""
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString("utf-8") })
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString("utf-8") })
    const timer = setTimeout(() => { try { child.kill() } catch {} resolve({ stdout, stderr, exitCode: -1 }) }, TIMEOUT_MS)
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? -1 }) })
    child.on("error", () => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: -1 }) })
  })
}

function detectTestRunner(cwd: string): { command: string; name: string } | null {
  const pkgPath = path.join(cwd, "package.json")
  try {
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.vitest) return { command: "npx vitest run 2>&1", name: "vitest" }
    if (deps.jest) return { command: "npx jest --no-cache 2>&1", name: "jest" }
    if (deps["@playwright/test"]) return { command: "npx playwright test 2>&1", name: "playwright" }
    if (deps.mocha) return { command: "npx mocha 2>&1", name: "mocha" }
    if (deps.cypress) return { command: "npx cypress run 2>&1", name: "cypress" }
    // Check for test script
    if (pkg.scripts?.test) return { command: `npm test 2>&1`, name: "npm test" }
  } catch {}
  return null
}

interface TestFailure {
  file: string
  test: string
  error: string
}

function parseJestOutput(raw: string): { passed: number; failed: number; failures: TestFailure[] } {
  let passed = 0, failed = 0
  const failures: TestFailure[] = []
  const re = /^\s*✕\s+(.+)$/gm
  let currentFile = ""
  for (const line of raw.split("\n")) {
    const fileMatch = line.match(/^\s*(?:PASS|FAIL)\s+(.+)$/)
    if (fileMatch) { currentFile = fileMatch[1].trim(); continue }
    if (line.includes("Tests:")) {
      const numMatch = line.match(/(\d+)\s+failed/); if (numMatch) failed = parseInt(numMatch[1])
      const passMatch = line.match(/(\d+)\s+passed/); if (passMatch) passed = parseInt(passMatch[1])
    }
    if (line.trim().startsWith("✕") || line.trim().startsWith("×")) {
      const testName = line.replace(/^\s*[✕×]\s*/, "").trim()
      failures.push({ file: currentFile, test: testName, error: "" })
    }
  }
  return { passed, failed, failures: failures.slice(0, 20) }
}

function parseVitestOutput(raw: string): { passed: number; failed: number; failures: TestFailure[] } {
  let passed = 0, failed = 0
  const failures: TestFailure[] = []
  const lines = raw.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes("Test Files") || line.includes("Tests")) {
      const fMatch = line.match(/(\d+)\s+failed/); if (fMatch) failed = Math.max(failed, parseInt(fMatch[1]))
      const pMatch = line.match(/(\d+)\s+passed/); if (pMatch) passed = Math.max(passed, parseInt(pMatch[1]))
    }
    if (line.includes("FAIL") || (line.includes("×") && lines[i - 1]?.includes("FAIL"))) {
      const fileMatch = line.match(/^(?:FAIL|×)\s+(.+)$/)
      if (fileMatch) {
        // Grab error context from next few lines
        const errorLines: string[] = []
        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          if (lines[j].trim() === "" || lines[j].includes("FAIL") || lines[j].includes("PASS")) break
          errorLines.push(lines[j].trim())
        }
        failures.push({ file: fileMatch[1].trim(), test: "", error: errorLines.join("\n") })
      }
    }
  }
  return { passed, failed, failures: failures.slice(0, 20) }
}

export const runTestsTool = {
  name: "run_tests",
  description: "Detect and run the project's test suite (jest, vitest, mocha, playwright, or npm test). Parses results into passed/failed counts and a list of failing tests with file, name, and error. Use this after making code changes to verify nothing broke. 60 second timeout.",
  schema: { test_command: "string?" },
  async execute(args: { test_command?: string }) {
    const cwd = WORKSPACE
    const runner = args.test_command
      ? { command: args.test_command, name: "custom" }
      : detectTestRunner(cwd)

    if (!runner) {
      return { success: true, data: { total: 0, passed: 0, failed: 0, runner: "none", failures: [], output: "No test runner detected. Install jest, vitest, or mocha, or provide a test_command." } }
    }

    const { stdout, stderr, exitCode } = await runCommand(runner.command, cwd)
    const output = stdout + (stderr ? "\n" + stderr : "")

    let result: { passed: number; failed: number; failures: TestFailure[] }
    if (runner.name === "vitest") {
      result = parseVitestOutput(output)
    } else {
      result = parseJestOutput(output)
    }

    return {
      success: true,
      data: {
        total: result.passed + result.failed,
        passed: result.passed,
        failed: result.failed,
        runner: runner.name,
        failures: result.failures,
        exitCode,
        outputTail: output.length > 5000 ? output.slice(-5000) : output,
      },
    }
  },
  async verify(_args: Record<string, unknown>, result: { success: boolean; data?: { total?: number; failed?: number } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    return { verified: true, evidence: { total: result.data?.total ?? 0, failed: result.data?.failed ?? 0 } }
  },
}
