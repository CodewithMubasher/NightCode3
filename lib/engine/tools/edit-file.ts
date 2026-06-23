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

// ── Replacer strategies ────────────────────────────────────────────────────

function simple(content: string, oldStr: string, newStr: string): string | null {
  if (content.includes(oldStr)) {
    return content.replace(oldStr, newStr)
  }
  return null
}

function lineTrimmed(content: string, oldStr: string, newStr: string): string | null {
  const normalizedOld = oldStr.split("\n").map((l) => l.trimEnd()).join("\n")
  const normalizedContent = content.split("\n").map((l) => l.trimEnd()).join("\n")
  if (normalizedContent.includes(normalizedOld)) {
    return content.replace(normalizedOld, newStr)
  }
  return null
}

function whitespaceNormalized(content: string, oldStr: string, newStr: string): string | null {
  const normalize = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim()
  const nContent = normalize(content)
  const nOld = normalize(oldStr)
  if (nContent.includes(nOld)) {
    const idx = nContent.indexOf(nOld)
    const before = content.slice(0, idx + (idx > 0 ? 1 : 0))
    return before + newStr
  }
  return null
}

function indentationFlexible(content: string, oldStr: string, newStr: string): string | null {
  const oldLines = oldStr.split("\n")
  const contentLines = content.split("\n")
  const firstLine = oldLines[0].trim()

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() === firstLine) {
      const indent = contentLines[i].length - contentLines[i].trimStart().length
      const indentedOld = oldLines.map((l, idx) => {
        if (idx === 0) return contentLines[i]
        const lineIndent = l.length - l.trimStart().length
        return " ".repeat(indent + lineIndent) + l.trimStart()
      }).join("\n")

      if (content.substring(i * (contentLines[0]?.length ?? 0)).startsWith(indentedOld)) {
        return content.replace(indentedOld, newStr)
      }
    }
  }
  return null
}

function blockAnchor(content: string, oldStr: string, newStr: string): string | null {
  const oldLines = oldStr.split("\n")
  if (oldLines.length < 3) return null
  const firstAnchor = oldLines[0].trim()
  const lastAnchor = oldLines[oldLines.length - 1].trim()
  const contentLines = content.split("\n")

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() === firstAnchor) {
      for (let j = contentLines.length - 1; j > i; j--) {
        if (contentLines[j].trim() === lastAnchor) {
          const block = contentLines.slice(i, j + 1).join("\n")
          if (block.length >= oldStr.length * 0.7 && block.length <= oldStr.length * 1.3) {
            return content.replace(block, newStr)
          }
        }
      }
    }
  }
  return null
}

const replacers = [
  { name: "simple", fn: simple },
  { name: "lineTrimmed", fn: lineTrimmed },
  { name: "whitespaceNormalized", fn: whitespaceNormalized },
  { name: "indentationFlexible", fn: indentationFlexible },
  { name: "blockAnchor", fn: blockAnchor },
]

// ── Tool export ────────────────────────────────────────────────────────────

export const editFileTool = {
  name: "edit_file",
  description: "Replace exact text in a file. Use for small, precise changes — fix a typo, update a variable name, change a single line. Provide the exact old_string to replace and the new_string to insert. For large changes, use write_file instead.",
  schema: { path: "string", old_string: "string", new_string: "string" },
  async execute(args: { path: string; old_string: string; new_string: string }) {
    const resolved = resolvePath(args.path)
    const content = fs.readFileSync(resolved, "utf-8")

    for (const replacer of replacers) {
      try {
        const result = replacer.fn(content, args.old_string, args.new_string)
        if (result !== null) {
          fs.writeFileSync(resolved, result, "utf-8")
          return {
            success: true,
            data: {
              path: args.path,
              strategy: replacer.name,
              replaced: args.old_string.length,
              inserted: args.new_string.length,
            },
          }
        }
      } catch {}
    }

    return {
      success: false,
      error: `old_string not found in file after trying ${replacers.length} matching strategies. Provide the exact text to replace, or use write_file to rewrite the entire file.`,
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
