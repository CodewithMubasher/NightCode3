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
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`MCP connection timed out after ${timeoutMs}ms`)), timeoutMs)
    })

    let toolsResult: Awaited<ReturnType<typeof client.listTools>>
    try {
      toolsResult = await Promise.race([toolsPromise, timeoutPromise])
    } finally {
      clearTimeout(timer)
    }
    const toolNames = (toolsResult.tools ?? []).map((t) => t.name)

    connections.set(config.name, { config, client })
    return toolNames
  } catch (err) {
    throw new Error(`Failed to connect MCP '${config.name}': ${err instanceof Error ? err.message : "Unknown error"}`)
  }
}

export async function ensureConnected(config: MCPConfig): Promise<void> {
  if (connections.has(config.name)) return
  try {
    await connectMCP(config)
    console.log(`MCP connected: ${config.name}`)
  } catch (err) {
    console.error(`MCP connect failed for ${config.name}:`, (err as Error).message)
  }
}

export async function disconnectMCP(name: string): Promise<void> {
  const conn = connections.get(name)
  if (conn) {
    try {
      await conn.client.close()
    } catch (e) { console.error("[mcp] Failed to connect:", e) }
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
    names.push(conn.config.name)
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

// Warm connections persist until server shutdown (not per-request)
async function shutdown() {
  await disconnectAll()
}
process.on("SIGINT", async () => { await shutdown(); process.exit(0) })
process.on("SIGTERM", async () => { await shutdown(); process.exit(0) })
