import * as fs from "fs"
import * as path from "path"
import { NextResponse } from "next/server"

const SKILLS_DIR = path.resolve(process.cwd(), ".skills")

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const filePath = path.join(SKILLS_DIR, `${slug}.md`)
  if (!filePath.startsWith(SKILLS_DIR) || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 })
  }
  const content = fs.readFileSync(filePath, "utf-8")
  const title = content.split("\n")[0]?.replace(/^#{1,6}\s*/, "").trim() || slug
  return NextResponse.json({ slug, title, content })
}
