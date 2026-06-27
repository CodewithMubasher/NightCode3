import * as fs from "fs"
import * as path from "path"
import { resolvePath as resolveWorkspacePath } from "../path-utils"

function resolvePath(filePath: string): string {
  return resolveWorkspacePath(filePath)
}

export const writeFileTool = {
  name: "write_file",
  description: "Write content to a file (relative path). CRITICAL: When creating a project or multiple related files (e.g., index.html, style.css, app.js), you MUST call this tool multiple times in PARALLEL within a single response step. Never write files one at a time.",
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
      const stat = fs.statSync(resolved)
      return { verified: true, evidence: { path: args.path, bytes: stat.size } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
