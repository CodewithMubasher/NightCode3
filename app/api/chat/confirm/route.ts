import { NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"
import { createFileSnapshot } from "@/lib/db/adapter"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

export async function POST(req: Request) {
  try {
    const { chatId, messageId, toolCallId, path: rawPath } = await req.json()
    if (!rawPath || typeof rawPath !== "string") {
      return NextResponse.json({ success: false, error: "Missing path" }, { status: 400 })
    }

    const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(WORKSPACE, rawPath)
    const resolved = path.normalize(candidate)
    if (!resolved.startsWith(WORKSPACE)) {
      return NextResponse.json({ success: false, error: `Path traversal denied: "${rawPath}" is outside the workspace` }, { status: 403 })
    }

    let originalContent: string | null = null
    let existedBefore = 1
    try {
      if (fs.existsSync(resolved)) {
        originalContent = fs.readFileSync(resolved, "utf-8")
      } else {
        existedBefore = 0
      }
    } catch {
      existedBefore = 0
    }

    const snapshotId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    createFileSnapshot({
      id: snapshotId,
      session_id: messageId ?? "",
      tool_call_id: toolCallId ?? "",
      tool_name: "delete_file",
      file_path: rawPath,
      original_content: originalContent,
      existed_before: existedBefore,
      created_at: Date.now(),
    })

    fs.rmSync(resolved, { recursive: true, force: true })

    return NextResponse.json({ success: true, data: { path: rawPath } })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
