import * as fs from "fs"
import * as path from "path"
import { getSnapshotsBySession, deleteSessionCascade } from "@/lib/db/adapter"

const WORKSPACE = process.env.BUILD_WORKSPACE || process.cwd()

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(WORKSPACE, filePath)
}

export async function rollbackMessage(messageId: string): Promise<void> {
  const snapshots = getSnapshotsBySession(messageId)

  for (const snap of snapshots.reverse()) {
    const resolved = resolvePath(snap.file_path)

    if (snap.tool_name === "write_file" || snap.tool_name === "delete_file") {
      if (snap.existed_before && snap.original_content !== null) {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, snap.original_content, "utf-8")
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
