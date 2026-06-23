import * as fs from "fs"
import * as path from "path"

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024
const OUTPUT_DIR = path.resolve(process.cwd(), ".nightcode", "tool-output")
const CLEANUP_AGE_MS = 7 * 24 * 3600 * 1000

function ensureDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }
}

function cleanupOldFiles(): void {
  try {
    ensureDir()
    const now = Date.now()
    for (const entry of fs.readdirSync(OUTPUT_DIR)) {
      const fp = path.join(OUTPUT_DIR, entry)
      try {
        if (fs.statSync(fp).mtimeMs < now - CLEANUP_AGE_MS) {
          fs.unlinkSync(fp)
        }
      } catch {}
    }
  } catch {}
}

let cleanupDone = false

export function boundToolOutput(toolCallId: string, output: unknown): unknown {
  if (!cleanupDone) {
    cleanupOldFiles()
    cleanupDone = true
  }

  const raw = typeof output === "string" ? output : JSON.stringify(output, null, 2)
  const lines = raw.split("\n")
  const bytes = Buffer.byteLength(raw, "utf-8")

  if (lines.length <= MAX_LINES && bytes <= MAX_BYTES) {
    return output
  }

  ensureDir()
  const filePath = path.join(OUTPUT_DIR, `tool_${toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`)
  fs.writeFileSync(filePath, raw, "utf-8")

  const head = lines.slice(0, 100).join("\n")
  const tail = lines.slice(-100).join("\n")
  const preview = lines.length > MAX_LINES
    ? `[Output truncated: ${lines.length} lines (limit ${MAX_LINES}). Full output saved to ${filePath}]\n\n${head}\n...\n${tail}`
    : `[Output truncated: ${(bytes / 1024).toFixed(1)}KB (limit ${(MAX_BYTES / 1024).toFixed(0)}KB). Full output saved to ${filePath}]\n\n${raw.slice(0, 3000)}`

  return preview
}
