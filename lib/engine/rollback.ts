import * as fs from "fs"
import * as path from "path"
import { getSnapshotsBySession, deleteSessionCascade } from "@/lib/db/adapter"

const WORKSPACE_ABS = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function resolvePath(filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ABS, filePath)
  const normalized = path.normalize(resolved)
  if (!normalized.startsWith(WORKSPACE_ABS)) {
    throw new Error(`Path traversal denied: "${filePath}" is outside the workspace`)
  }
  return normalized
}

export async function rollbackMessage(messageId: string): Promise<void> {
  const snapshots = getSnapshotsBySession(messageId)

  for (const snap of snapshots.reverse()) {
    const resolved = resolvePath(snap.file_path)

    if (snap.tool_name === "write_file" || snap.tool_name === "delete_file") {
      if (snap.existed_before && snap.original_content !== null) {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, snap.original_content, "utf-8")
      } else if (snap.existed_before && snap.original_content === null) {
        // write_file on existing file — content not stored (bloat optimization).
        // Leave the file as-is; cannot restore exact pre-edit state.
      } else {
        try {
          fs.rmSync(resolved, { recursive: true, force: true })
        } catch {
          // already gone
        }
      }
    } else if (snap.tool_name === "create_folder") {
      if (!snap.existed_before) {
        try {
          fs.rmSync(resolved, { recursive: true, force: true })
        } catch {
          // already gone
        }
      }
    }
  }

  deleteSessionCascade(messageId)
}
