import * as fs from "fs"
import * as path from "path"
import { NextResponse } from "next/server"

const SKILLS_DIR = path.resolve(process.cwd(), ".skills")

export async function GET() {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      return NextResponse.json([])
    }
    const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"))
    const skills = files.map((f) => {
      const slug = f.replace(/\.md$/, "")
      const content = fs.readFileSync(path.join(SKILLS_DIR, f), "utf-8")
      const title = content.split("\n")[0]?.replace(/^#{1,6}\s*/, "").trim() || slug
      return { slug, title }
    })
    return NextResponse.json(skills)
  } catch {
    return NextResponse.json([])
  }
}
