import * as fs from "fs"
import { resolvePath as resolveWorkspacePath } from "../path-utils"

function resolvePath(filePath: string): string {
  return resolveWorkspacePath(filePath)
}

// ── Replacer strategies ────────────────────────────────────────────────────
// Each strategy returns the FULL new file content, or null if it cannot match.
// They are tried in order; the first non-null result wins.

function simple(content: string, oldStr: string, newStr: string): string | null {
  // Exact substring match. String.replace with a string pattern replaces only
  // the FIRST occurrence, which is what we want for a surgical edit.
  if (content.includes(oldStr)) {
    return content.replace(oldStr, newStr)
  }
  return null
}

function lineTrimmed(content: string, oldStr: string, newStr: string): string | null {
  // Match ignoring trailing whitespace on each line (common with editors that
  // strip trailing spaces). We locate the block by comparing trimmed-end lines.
  const normOld = oldStr.split("\n").map((l) => l.trimEnd()).join("\n")
  const contentLines = content.split("\n")
  const oldLines = normOld.split("\n")
  const startIdx = indexOfSubarray(contentLines.map((l) => l.trimEnd()), oldLines)
  if (startIdx === -1) return null
  const endIdx = startIdx + oldLines.length
  return [...contentLines.slice(0, startIdx), ...newStr.split("\n"), ...contentLines.slice(endIdx)].join("\n")
}

function whitespaceNormalized(content: string, oldStr: string, newStr: string): string | null {
  // Collapse runs of whitespace so formatting differences don't block a match.
  // CRITICAL: preserve everything before and after the match (old impl discarded the tail).
  const normalize = (s: string): string => s.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()
  const nContent = normalize(content)
  const nOld = normalize(oldStr)
  const idx = nContent.indexOf(nOld)
  if (idx === -1) return null
  // Find the corresponding raw span in the original content by walking both.
  // Map normalized index back to a raw char range using a parallel scan.
  let rawStart = -1
  let rawEnd = -1
  let ni = 0
  let ri = 0
  while (ri < content.length && ni < idx) {
    if (content[ri] === nContent[ni]) {
      ri++
      ni++
    } else {
      // content[ri] is whitespace that gets collapsed/skipped in normalized form
      ri++
    }
  }
  rawStart = ri
  // Continue walking to consume the matched normalized region
  const targetEnd = idx + nOld.length
  while (ri < content.length && ni < targetEnd) {
    if (content[ri] === nContent[ni]) {
      ri++
      ni++
    } else {
      ri++
    }
  }
  rawEnd = ri
  return content.slice(0, rawStart) + newStr + content.slice(rawEnd)
}

function indentationFlexible(content: string, oldStr: string, newStr: string): string | null {
  // Match the block by its first line, then re-indent the old block to the
  // indentation actually present in the file. Fixes the previous broken impl
  // that used byte-offset arithmetic on line lengths.
  const oldLines = oldStr.split("\n")
  const contentLines = content.split("\n")
  const firstTrimmed = oldLines[0].trim()
  if (!firstTrimmed) return null

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstTrimmed) continue
    const indent = contentLines[i].length - contentLines[i].trimStart().length
    // Reconstruct what oldStr would look like at this indentation
    const reindented = oldLines.map((l, idx) => {
      if (idx === 0) return contentLines[i]
      const li = l.length - l.trimStart().length
      return " ".repeat(indent) + l.trimStart()
    }).join("\n")
    if (content.includes(reindented)) {
      return content.replace(reindented, newStr)
    }
    // Looser: compare line-by-line trimmed
    const candidate = contentLines.slice(i, i + oldLines.length)
    if (candidate.length === oldLines.length) {
      const allMatch = candidate.every((cl, idx) => cl.trim() === oldLines[idx].trim())
      if (allMatch) {
        const reindentedNew = newStr.split("\n").map((l, idx) => {
          if (idx === 0) return contentLines[i].slice(0, indent) + l.trimStart()
          const li = l.length - l.trimStart().length
          return " ".repeat(indent) + l.trimStart()
        }).join("\n")
        return [...contentLines.slice(0, i), ...reindentedNew.split("\n"), ...contentLines.slice(i + oldLines.length)].join("\n")
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
  if (!firstAnchor || !lastAnchor) return null
  const contentLines = content.split("\n")

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstAnchor) continue
    for (let j = i + oldLines.length - 1; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastAnchor) {
        const block = contentLines.slice(i, j + 1).join("\n")
        const ratio = block.length / Math.max(oldStr.length, 1)
        if (ratio >= 0.6 && ratio <= 1.6) {
          return [...contentLines.slice(0, i), ...newStr.split("\n"), ...contentLines.slice(j + 1)].join("\n")
        }
      }
    }
  }
  return null
}

function escapeNormalized(content: string, oldStr: string, newStr: string): string | null {
  // Handle the case where the model double-escaped \\n, \\t, \\" in its old_string.
  const unescape = (s: string): string => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  const normalizedOld = unescape(oldStr)
  if (normalizedOld === oldStr) return null // nothing to normalize; let other strategies try
  if (content.includes(normalizedOld)) {
    return content.replace(normalizedOld, newStr)
  }
  return null
}

function trimmedBoundary(content: string, oldStr: string, newStr: string): string | null {
  // Single-line match ignoring leading/trailing whitespace on the whole old_string.
  const trimmedOld = oldStr.trim()
  if (!trimmedOld || trimmedOld.includes("\n")) return null
  const contentLines = content.split("\n")
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() === trimmedOld) {
      const indent = contentLines[i].length - contentLines[i].trimStart().length
      contentLines[i] = " ".repeat(indent) + newStr.trim()
      return contentLines.join("\n")
    }
  }
  return null
}

function multiOccurrence(content: string, oldStr: string, newStr: string): string | null {
  // If oldStr appears exactly once, replace it. If it appears multiple times,
  // we cannot know which to replace, so return null and let context-aware try.
  const count = countOccurrences(content, oldStr)
  if (count === 1) {
    return content.replace(oldStr, newStr)
  }
  return null
}

function contextAware(content: string, oldStr: string, newStr: string): string | null {
  // Match by first and last non-empty line of oldStr, replacing everything between.
  const oldLines = oldStr.split("\n").filter((l) => l.trim().length > 0)
  if (oldLines.length < 2) return null
  const contentLines = content.split("\n")
  const firstTrimmed = oldLines[0].trim()
  const lastTrimmed = oldLines[oldLines.length - 1].trim()

  let startIdx = -1
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() === firstTrimmed) { startIdx = i; break }
  }
  if (startIdx === -1) return null

  let endIdx = -1
  for (let i = startIdx + 1; i < contentLines.length; i++) {
    if (contentLines[i].trim() === lastTrimmed) { endIdx = i; break }
  }
  if (endIdx === -1) return null

  return [
    ...contentLines.slice(0, startIdx),
    ...newStr.split("\n"),
    ...contentLines.slice(endIdx + 1),
  ].join("\n")
}

function semanticLineMatch(content: string, oldStr: string, newStr: string): string | null {
  // Strategy 10: compare lines by their "semantic" form — strip ALL whitespace
  // and punctuation noise, compare only the meaningful code tokens. Useful when
  // the model's old_string has slightly different spacing/quotes than the file.
  const tokenize = (line: string): string =>
    line.replace(/["'`]/g, "").replace(/[ \t]+/g, "").replace(/[,;:]/g, "").trim()

  const oldLines = oldStr.split("\n")
  const contentLines = content.split("\n")
  const tokens = oldLines.map(tokenize)

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let match = true
    for (let j = 0; j < oldLines.length; j++) {
      if (tokenize(contentLines[i + j]) !== tokens[j]) { match = false; break }
    }
    if (match) {
      // Preserve file indentation for the first line of the replacement
      const indent = contentLines[i].length - contentLines[i].trimStart().length
      const newLines = newStr.split("\n")
      if (newLines.length > 0) {
        newLines[0] = " ".repeat(indent) + newLines[0].trimStart()
      }
      return [
        ...contentLines.slice(0, i),
        ...newLines,
        ...contentLines.slice(i + oldLines.length),
      ].join("\n")
    }
  }
  return null
}

// ── helpers ────────────────────────────────────────────────────────────────

function indexOfSubarray<T>(arr: T[], sub: T[]): number {
  outer: for (let i = 0; i <= arr.length - sub.length; i++) {
    for (let j = 0; j < sub.length; j++) {
      if (arr[i + j] !== sub[j]) continue outer
    }
    return i
  }
  return -1
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

const replacers = [
  { name: "simple", fn: simple },
  { name: "lineTrimmed", fn: lineTrimmed },
  { name: "whitespaceNormalized", fn: whitespaceNormalized },
  { name: "indentationFlexible", fn: indentationFlexible },
  { name: "blockAnchor", fn: blockAnchor },
  { name: "escapeNormalized", fn: escapeNormalized },
  { name: "trimmedBoundary", fn: trimmedBoundary },
  { name: "multiOccurrence", fn: multiOccurrence },
  { name: "contextAware", fn: contextAware },
  { name: "semanticLineMatch", fn: semanticLineMatch },
]

// ── Tool export ────────────────────────────────────────────────────────────

export const editFileTool = {
  name: "edit_file",
  description: "Replace exact text in a file. Use for surgical changes: fix a typo, rename a variable, update a single line or function. Provide the EXACT old_string as it appears in the file (copy it from read_file output). The tool tries 10 matching strategies (exact, whitespace-flexible, indentation-flexible, semantic) so minor formatting differences still match. For changes affecting more than ~50% of the file, use write_file instead. If old_string appears multiple times, include enough surrounding context to make it unique.",
  schema: { path: "string", old_string: "string", new_string: "string" },
  async execute(args: { path: string; old_string: string; new_string: string }) {
    if (!args.old_string) {
      return { success: false, error: "old_string is required and cannot be empty." }
    }
    if (args.old_string === args.new_string) {
      return { success: false, error: "old_string and new_string are identical — nothing to change." }
    }
    const resolved = resolvePath(args.path)
    let content: string
    try {
      content = fs.readFileSync(resolved, "utf-8")
    } catch (err) {
      return {
        success: false,
        error: `Could not read file "${args.path}": ${err instanceof Error ? err.message : "unknown error"}. Use write_file to create it.`,
      }
    }

    const occurrences = countOccurrences(content, args.old_string)
    for (const replacer of replacers) {
      try {
        const result = replacer.fn(content, args.old_string, args.new_string)
        if (result !== null && result !== content) {
          fs.writeFileSync(resolved, result, "utf-8")
          return {
            success: true,
            data: {
              path: args.path,
              strategy: replacer.name,
              replacedChars: args.old_string.length,
              insertedChars: args.new_string.length,
              exactOccurrencesBefore: occurrences,
            },
          }
        }
      } catch (e) { console.error("[edit-file] Strategy", replacer.name, "error:", e) }
    }

    // Helpful failure: show the closest line in the file so the LLM can correct itself.
    const firstLine = args.old_string.split("\n")[0].trim()
    const contentLines = content.split("\n")
    let suggestion = ""
    if (firstLine) {
      const idx = contentLines.findIndex((l) => l.includes(firstLine.slice(0, Math.min(20, firstLine.length))))
      if (idx >= 0) {
        suggestion = ` The file contains a similar line ${idx + 1}: "${contentLines[idx].trim()}". Copy the exact text from the file and try again.`
      }
    }
    return {
      success: false,
      error: `old_string not found in "${args.path}" after trying ${replacers.length} matching strategies (exact occurrences of your full old_string: ${occurrences}).${suggestion} If the change is large, use write_file to rewrite the whole file.`,
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
      // For multi-line replacements, check the first line of new_string is present
      const firstNewLine = args.new_string.split("\n")[0]
      if (!content.includes(firstNewLine)) {
        return { verified: false, discrepancy: "Edited content not found in file after write" }
      }
      return { verified: true, evidence: { path: args.path } }
    } catch (err) {
      return { verified: false, discrepancy: err instanceof Error ? err.message : "Verification error" }
    }
  },
}
