import type { ToolImplementation } from "@/lib/engine/tools"
import { loadMCPConfigs } from "./storage"
import { connectMCP, ensureConnected } from "./manager"

let mcpBuiltinTools: ToolImplementation[] = []

export function setMCPBuiltinTools(tools: ToolImplementation[]): void {
  mcpBuiltinTools = tools
}

export function getMCPBuiltinTools(): ToolImplementation[] {
  return mcpBuiltinTools
}

export async function listAllMCPTools(): Promise<{ name: string; description: string; inputSchema: any }[]> {
  const { connections } = await import("./manager")
  const allTools: { name: string; description: string; inputSchema: any }[] = []
  for (const [, conn] of connections) {
    try {
      const result = await conn.client.listTools()
      for (const tool of result.tools ?? []) {
        allTools.push({
          name: `${conn.config.name.trim()}_${tool.name.trim()}`,
          description: tool.description ?? `${conn.config.name} MCP tool`,
          inputSchema: tool.inputSchema,
        })
      }
    } catch (e) { console.error("[mcp/tools] Failed to read:", e) }
  }
  return allTools
}

export async function createMCPToolImplementations(): Promise<ToolImplementation[]> {
  const { connections } = await import("./manager")
  const configs = loadMCPConfigs()

  // Connect only servers that aren't already warm
  for (const config of configs) {
    if (config.enabled) {
      await ensureConnected(config)
    }
  }

  const tools: ToolImplementation[] = []

  for (const [, conn] of connections) {
    try {
      const result = await conn.client.listTools()
      for (const mcpTool of result.tools ?? []) {
        const toolName = `${conn.config.name.trim()}_${mcpTool.name.trim()}`
        const schema: Record<string, string> = {}
        if (mcpTool.inputSchema?.properties) {
          for (const [key, val] of Object.entries(mcpTool.inputSchema.properties)) {
            schema[key] = (val as any).type ?? "string"
          }
        }

        tools.push({
          name: toolName,
          description: mcpTool.description ?? `${conn.config.name} tool`,
          schema,
          async execute(args: any) {
            try {
              const res = await conn.client.callTool({
                name: mcpTool.name,
                arguments: args,
              })
              const content = (res.content ?? []) as any[]
              const text = content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n")
              return { success: true, data: { text, raw: res } }
            } catch (err) {
              return { success: false, error: (err as Error).message }
            }
          },
          async verify(_args: any, result: any) {
            return { verified: result.success, evidence: {} }
          },
        })
      }
    } catch {
      console.error(`MCP failed to list tools for ${conn.config.name}`)
    }
  }

  return tools
}
