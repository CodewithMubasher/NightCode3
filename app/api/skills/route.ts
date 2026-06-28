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
      const lines = content.split("\n")
      const title = lines[0]?.replace(/^#{1,6}\s*/, "").trim() || slug
      const descLines: string[] = []
      let inDesc = false
      for (const line of lines.slice(1)) {
        const trimmed = line.trim()
        if (!trimmed) {
          if (inDesc) break
          continue
        }
        if (trimmed.startsWith("#") || trimmed.startsWith("###") || trimmed.startsWith("##")) break
        if (!inDesc) inDesc = true
        descLines.push(trimmed)
      }
      const description = descLines.length > 0 ? descLines.join(" ") : undefined
      const tagsMatch = content.match(/<!--\s*tags:\s*([\w\s,]+)\s*-->/i)
      const tags = tagsMatch ? tagsMatch[1].split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : undefined
      return { slug, title, description, tags }
    })
    return NextResponse.json(skills)
  } catch {
    return NextResponse.json([])
  }
}
