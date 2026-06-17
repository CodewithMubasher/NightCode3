import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { MCPConfig } from "./storage"

interface ConnectedMCP {
  config: MCPConfig
  client: Client
}

export const connections = new Map<string, ConnectedMCP>()

export async function connectMCP(config: MCPConfig): Promise<string[]> {
  try {
    if (connections.has(config.name)) {
      await disconnectMCP(config.name)
    }

    let transport: StdioClientTransport

    if (config.type === "local") {
      const commandParts = (config.command ?? "").split(/\s+/)
      transport = new StdioClientTransport({
        command: commandParts[0],
        args: [...commandParts.slice(1), ...(config.args ?? [])],
        env: config.environment,
      })
    } else {
      throw new Error("Remote MCP not yet supported")
    }

    const client = new Client({
      name: "nightcode",
      version: "1.0.0",
    })

    const timeoutMs = 10_000
    const connectPromise = client.connect(transport)
    const toolsPromise = connectPromise.then(() => client.listTools())
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP connection timed out after ${timeoutMs}ms`)), timeoutMs)
      // Clean up timer if the other promise settles first
      Promise.race([connectPromise, toolsPromise]).finally(() => clearTimeout(timer))
    })

    const toolsResult = await Promise.race([toolsPromise, timeoutPromise])
    const toolNames = (toolsResult.tools ?? []).map((t) => t.name)

    connections.set(config.name, { config, client })
    return toolNames
  } catch (err) {
    throw new Error(`Failed to connect MCP '${config.name}': ${err instanceof Error ? err.message : "Unknown error"}`)
  }
}

export async function disconnectMCP(name: string): Promise<void> {
  const conn = connections.get(name)
  if (conn) {
    try {
      await conn.client.close()
    } catch {}
    connections.delete(name)
  }
}

export async function disconnectAll(): Promise<void> {
  for (const name of connections.keys()) {
    await disconnectMCP(name)
  }
}

export function getConnectedToolNames(): string[] {
  const names: string[] = []
  for (const [, conn] of connections) {
    names.push(...conn.config.name)
  }
  return names
}

export function getConnectionStatus(name: string): "connected" | "disconnected" | "error" {
  return connections.has(name) ? "connected" : "disconnected"
}

export function getAllConnectionStatuses(configs: MCPConfig[]): Record<string, "connected" | "disconnected" | "error"> {
  const statuses: Record<string, "connected" | "disconnected" | "error"> = {}
  for (const config of configs) {
    statuses[config.name] = getConnectionStatus(config.name)
  }
  return statuses
}

// Cleanup all MCP processes on server shutdown
async function shutdown() {
  await disconnectAll()
}
process.on("SIGINT", async () => { await shutdown(); process.exit(0) })
process.on("SIGTERM", async () => { await shutdown(); process.exit(0) })
