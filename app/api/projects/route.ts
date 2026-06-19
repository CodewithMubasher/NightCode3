import { NextResponse } from "next/server"
import { writeFile } from "fs/promises"
import { mkdir } from "fs/promises"
import { join } from "path"

export async function POST(request: Request) {
  try {
    const { id, name } = await request.json() as { id: string; name: string; description?: string }
    if (!id || !name) {
      return NextResponse.json({ error: "Missing id or name" }, { status: 400 })
    }

    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    const workspaceDir = join(process.cwd(), "workspace", slug)
    const memoryDir = join(workspaceDir, ".nightcode", "memory")

    await mkdir(memoryDir, { recursive: true })

    const files: Record<string, string> = {
      "facts.md": `# Project Facts — ${name}\n\nKey facts and context about this project.\n`,
      "decisions.md": `# Project Decisions — ${name}\n\nRecord of architectural and design decisions.\n`,
      "project.md": `# ${name}\n\n## Overview\n\n## Goals\n\n## Architecture\n`,
    }

    for (const [filename, content] of Object.entries(files)) {
      await writeFile(join(memoryDir, filename), content, "utf-8")
    }

    return NextResponse.json({ success: true, workspace: workspaceDir })
  } catch (error) {
    console.error("Failed to create project workspace:", error)
    return NextResponse.json({ error: "Failed to create project workspace" }, { status: 500 })
  }
}
