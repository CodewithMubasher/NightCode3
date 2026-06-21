import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function resolvePath(filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE, filePath)
  const normalized = path.normalize(resolved)
  if (!normalized.startsWith(WORKSPACE)) {
    throw new Error(`Path traversal denied: "${filePath}" is outside the workspace`)
  }
  return normalized
}

export const writeFileTool = {
  name: "write_file",
  description: "Write content to a file. Creates parent directories automatically.",
  schema: { path: "string", content: "string" },
  async execute(args: { path: string; content: string }) {
    const resolved = resolvePath(args.path)
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, args.content, "utf-8")
    return { success: true, data: { path: args.path, bytes: args.content.length } }
  },
  async verify(args: { path: string; content: string }, result: { success: boolean }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    try {
      const resolved = resolvePath(args.path)
      if (!fs.existsSync(resolved)) {
        return { verified: false, discrepancy: "File was not created on disk" }
      }
      const actual = fs.readFileSync(resolved, "utf-8")
      if (actual !== args.content) {
        return {
          verified: false,
          discrepancy: `Content mismatch: expected ${args.content.length} chars, got ${actual.length} chars`,
        }
      }
      return { verified: true, evidence: { path: args.path, bytes: actual.length } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
