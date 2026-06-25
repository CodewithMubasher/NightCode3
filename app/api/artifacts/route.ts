import { NextResponse } from "next/server"
import { listArtifacts, getArtifact, deleteArtifact, updateArtifact } from "@/lib/engine/artifact-store"

export async function GET() {
  try {
    const artifacts = listArtifacts()
    return NextResponse.json({ artifacts })
  } catch {
    return NextResponse.json({ artifacts: [] })
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    if (body.id && body.content != null) {
      updateArtifact(body.id, { content: body.content })
    } else if (body.id && body.title != null) {
      updateArtifact(body.id, { title: body.title })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (id) deleteArtifact(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
