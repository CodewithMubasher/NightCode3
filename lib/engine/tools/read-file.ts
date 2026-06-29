import * as fs from "fs"
import * as path from "path"

import { resolvePath as resolveWorkspacePath } from "../path-utils"

function resolvePath(filePath: string): string {
  return resolveWorkspacePath(filePath)
}

// Detect binary files by looking for NUL bytes in the first 8KB.
function isBinary(buf: Buffer): boolean {
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf
  return sample.indexOf(0) !== -1
}

const MAX_FILE_BYTES = 1_500_000 // ~1.5MB hard cap for a single read

export const readFileTool = {
  name: "read_file",
  description: "Read the contents of a text file. ALWAYS read a file before editing it so you have the exact current text. Optionally specify offset (1-based line number) and limit (number of lines) to read a specific section of large files instead of the whole file. Returns the content plus totalLines, startLine, endLine. Files larger than 1.5MB are truncated. Binary files (images, executables) are rejected with a clear message.",
  schema: { path: "string", offset: "number?", limit: "number?" },
  async execute(args: { path: string; offset?: number; limit?: number }) {
    const resolved = resolvePath(args.path)
    if (!fs.existsSync(resolved)) {
      const isAbs = path.isAbsolute(args.path)
      return {
        success: false,
        error: `File not found: ${args.path}` +
          (isAbs ? ` (resolved to: ${resolved})` : "") +
          `. Try: 1) check the path spelling, 2) use list_directory to find the correct file, 3) use an absolute path like F:/Projects/.../file.ts`
      }
    }

    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      return { success: false, error: `"${args.path}" is a directory. Use list_directory to see its contents.` }
    }

    // Read as a buffer first to detect binary content and enforce size.
    let buf: Buffer
    try {
      buf = fs.readFileSync(resolved)
    } catch (err) {
      return { success: false, error: `Could not read file: ${err instanceof Error ? err.message : "unknown error"}` }
    }

    if (isBinary(buf)) {
      const ext = path.extname(resolved).toLowerCase()
      return {
        success: false,
        error: `"${args.path}" appears to be a binary file (${ext || "unknown type"}, ${stat.size} bytes). read_file only supports text files.`,
      }
    }

    const truncatedBySize = buf.length > MAX_FILE_BYTES
    if (truncatedBySize) {
      buf = buf.subarray(0, MAX_FILE_BYTES)
    }

    let content = buf.toString("utf-8")
    // Strip UTF-8 BOM if present
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1)
    }

    const allLines = content.split("\n")
    const totalLines = allLines.length

    if (args.offset || args.limit) {
      const start = args.offset ? Math.max(0, args.offset - 1) : 0
      const count = args.limit ?? totalLines
      const sliced = allLines.slice(start, start + count)
      return {
        success: true,
        data: {
          content: sliced.join("\n"),
          path: args.path,
          totalLines,
          startLine: start + 1,
          endLine: Math.min(start + sliced.length, totalLines),
          truncatedBySize,
        },
      }
    }

    return {
      success: true,
      data: {
        content,
        path: args.path,
        size: stat.size,
        totalLines,
        truncatedBySize,
      },
    }
  },
  async verify(args: { path: string }, result: { success: boolean; data?: { content: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    try {
      const resolved = resolvePath(args.path)
      if (!fs.existsSync(resolved)) {
        return { verified: false, discrepancy: "File does not exist on disk" }
      }
      const stat = fs.statSync(resolved)
      return { verified: true, evidence: { path: args.path, size: stat.size } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
