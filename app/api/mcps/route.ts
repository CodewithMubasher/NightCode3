import { NextResponse } from "next/server"
import { loadMCPConfigs, addMCPConfig, removeMCPConfig, toggleMCPConfig, type MCPConfig } from "@/lib/mcp/storage"
import { connectMCP, disconnectMCP, getAllConnectionStatuses } from "@/lib/mcp/manager"

export async function GET() {
  const configs = loadMCPConfigs()
  const statuses = getAllConnectionStatuses(configs)
  return NextResponse.json({ configs, statuses })
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as MCPConfig & { action?: string }
    const { action, name } = body

    if (action === "delete") {
      await disconnectMCP(name)
      const configs = removeMCPConfig(name)
      return NextResponse.json({ configs, statuses: getAllConnectionStatuses(configs) })
    }

    if (action === "toggle") {
      const configs = toggleMCPConfig(name)
      const updated = configs.find((c) => c.name === name)
      if (updated?.enabled) {
        try {
          const tools = await connectMCP(updated)
          return NextResponse.json({ configs, statuses: getAllConnectionStatuses(configs), tools })
        } catch (err) {
          return NextResponse.json({ configs, statuses: getAllConnectionStatuses(configs), error: (err as Error).message })
        }
      } else {
        await disconnectMCP(name)
        return NextResponse.json({ configs, statuses: getAllConnectionStatuses(configs) })
      }
    }

    if (action === "connect") {
      const configs = loadMCPConfigs()
      const config = configs.find((c) => c.name === name)
      if (!config) return NextResponse.json({ error: "MCP not found" }, { status: 404 })
      try {
        const tools = await connectMCP(config)
        return NextResponse.json({ status: "connected", tools })
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 })
      }
    }

    const config: MCPConfig = {
      name: body.name,
      type: body.type,
      command: body.command,
      args: body.args,
      url: body.url,
      environment: body.environment,
      enabled: body.enabled ?? true,
    }

    if (!config.name || !config.type) {
      return NextResponse.json({ error: "Name and type are required" }, { status: 400 })
    }

    const configs = addMCPConfig(config)

    if (config.enabled) {
      try {
        const tools = await connectMCP(config)
        return NextResponse.json({ configs, statuses: getAllConnectionStatuses(configs), tools })
      } catch (err) {
        return NextResponse.json({ configs, statuses: getAllConnectionStatuses(configs), error: (err as Error).message })
      }
    }

    return NextResponse.json({ configs, statuses: getAllConnectionStatuses(configs) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
