import { NextRequest, NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())
const IMAGES_DIR = path.join(WORKSPACE, ".images")

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params
  const filename = pathSegments.join("/")

  // Prevent path traversal
  const resolved = path.resolve(IMAGES_DIR, filename)
  if (!resolved.startsWith(IMAGES_DIR)) {
    return new NextResponse("Forbidden", { status: 403 })
  }

  if (!fs.existsSync(resolved)) {
    return new NextResponse("Image not found", { status: 404 })
  }

  const buffer = fs.readFileSync(resolved)
  const ext = path.extname(filename).toLowerCase()
  const mime: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime[ext] ?? "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
