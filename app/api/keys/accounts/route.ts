import { NextResponse } from "next/server"
import { getAllAccounts, deleteAccount, addAccount } from "@/lib/keys"

export async function GET() {
  const accounts = getAllAccounts()
  return NextResponse.json(accounts)
}

export async function POST(request: Request) {
  try {
    const { label } = await request.json() as { label: string }
    if (!label?.trim()) {
      return NextResponse.json({ error: "Missing label" }, { status: 400 })
    }
    addAccount(label.trim())
    return NextResponse.json({ success: true, label: label.trim() })
  } catch {
    return NextResponse.json({ error: "Failed to add account" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { account_label } = await request.json() as { account_label: string }
    if (!account_label || account_label === "default") {
      return NextResponse.json({ error: "Cannot delete default account" }, { status: 400 })
    }
    deleteAccount(account_label)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
  }
}
