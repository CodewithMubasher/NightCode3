import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

function readOptional(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path")
  if (!filePath) {
    return new NextResponse("Missing path parameter", { status: 400 })
  }
  const resolved = path.resolve(WORKSPACE, filePath)
  const normalized = path.normalize(resolved)
  if (!normalized.startsWith(WORKSPACE)) {
    return new NextResponse("Path traversal denied", { status: 403 })
  }

  const html = readOptional(normalized)
  if (html === null) {
    return new NextResponse("File not found", { status: 404 })
  }

  const dir = path.dirname(normalized)

  // Inline linked CSS files
  let inlined = html.replace(
    /<link\s+[^>]*href="([^"]+\.css)"[^>]*\/?>/gi,
    (match, cssHref: string) => {
      const cssPath = path.resolve(dir, cssHref)
      if (!cssPath.startsWith(WORKSPACE)) return match
      const css = readOptional(cssPath)
      if (css === null) return match
      return `<style>${css}</style>`
    }
  )

  // Inline linked JS files
  inlined = inlined.replace(
    /<script\s+[^>]*src="([^"]+\.js)"[^>]*><\/script>/gi,
    (match, jsSrc: string) => {
      const jsPath = path.resolve(dir, jsSrc)
      if (!jsPath.startsWith(WORKSPACE)) return match
      const js = readOptional(jsPath)
      if (js === null) return match
      return `<script>${js}</script>`
    }
  )

  return new NextResponse(inlined, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
