import { NextResponse } from "next/server"
import { rollbackMessage } from "@/lib/engine/rollback"

export async function POST(req: Request) {
  try {
    const { messageId } = await req.json()
    if (!messageId || typeof messageId !== "string") {
      return NextResponse.json({ success: false, error: "Missing messageId" }, { status: 400 })
    }
    await rollbackMessage(messageId)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
