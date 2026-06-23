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

export const editFileTool = {
  name: "edit_file",
  description: "Replace exact text in a file. Use for small, precise changes — fix a typo, update a variable name, change a single line. Provide the exact old_string to replace and the new_string to insert. For large changes, use write_file instead.",
  schema: { path: "string", old_string: "string", new_string: "string" },
  async execute(args: { path: string; old_string: string; new_string: string }) {
    const resolved = resolvePath(args.path)
    const content = fs.readFileSync(resolved, "utf-8")

    if (!content.includes(args.old_string)) {
      return {
        success: false,
        error: `old_string not found in file. Provide the exact text to replace.`,
      }
    }

    const updated = content.replace(args.old_string, args.new_string)
    fs.writeFileSync(resolved, updated, "utf-8")

    return {
      success: true,
      data: {
        path: args.path,
        replaced: args.old_string.length,
        inserted: args.new_string.length,
      },
    }
  },
  async verify(args: { path: string; new_string: string }, result: { success: boolean }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    try {
      const resolved = resolvePath(args.path)
      if (!fs.existsSync(resolved)) {
        return { verified: false, discrepancy: "File does not exist on disk" }
      }
      const content = fs.readFileSync(resolved, "utf-8")
      if (!content.includes(args.new_string)) {
        return { verified: false, discrepancy: "Edited content not found in file" }
      }
      return { verified: true, evidence: { path: args.path } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
