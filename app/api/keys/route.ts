import { NextResponse } from "next/server"
import {
  getAllKeyEntries,
  setApiKey,
  deleteApiKey,
  setProviderAccount,
  getAllAccounts,
  maskKey,
} from "@/lib/keys"

export async function GET() {
  const entries = getAllKeyEntries()
  const accounts = getAllAccounts()
  const masked = entries.map((e) => ({
    ...e,
    key_value: maskKey(e.key_value),
  }))
  return NextResponse.json({ providers: masked, accounts })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { env_name: string; key_value: string; account_label?: string }
    const { env_name, key_value, account_label } = body
    if (!env_name) {
      return NextResponse.json({ error: "Missing env_name" }, { status: 400 })
    }
    setApiKey(env_name, key_value, account_label ?? "default")
    return NextResponse.json({ success: true, env_name, has_key: key_value.length > 0 })
  } catch {
    return NextResponse.json({ error: "Failed to save API key" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { env_name, account_label } = await request.json() as { env_name: string; account_label?: string }
    if (!env_name) {
      return NextResponse.json({ error: "Missing env_name" }, { status: 400 })
    }
    deleteApiKey(env_name, account_label ?? "default")
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete API key" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { env_name, account_label } = await request.json() as { env_name: string; account_label: string }
    if (!env_name || !account_label) {
      return NextResponse.json({ error: "Missing env_name or account_label" }, { status: 400 })
    }
    setProviderAccount(env_name, account_label)
    return NextResponse.json({ success: true, env_name, account_label })
  } catch {
    return NextResponse.json({ error: "Failed to set provider account" }, { status: 500 })
  }
}
