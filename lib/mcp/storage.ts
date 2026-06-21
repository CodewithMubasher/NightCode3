import * as fs from "fs"
import * as path from "path"

export interface MCPConfig {
  name: string
  type: "local" | "remote"
  command?: string
  args?: string[]
  url?: string
  environment?: Record<string, string>
  enabled: boolean
}

const CONFIG_PATH = path.resolve(process.cwd(), "mcp-servers.json")

export function loadMCPConfigs(): MCPConfig[] {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return []
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
    const configs: MCPConfig[] = JSON.parse(raw)
    for (const c of configs) {
      c.name = c.name.trim()
      c.command = c.command?.trim()
    }
    return configs
  } catch {
    return []
  }
}

export function saveMCPConfigs(configs: MCPConfig[]): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2))
}

export function addMCPConfig(config: MCPConfig): MCPConfig[] {
  const configs = loadMCPConfigs()
  const idx = configs.findIndex((c) => c.name === config.name)
  if (idx >= 0) {
    configs[idx] = config
  } else {
    configs.push(config)
  }
  saveMCPConfigs(configs)
  return configs
}

export function removeMCPConfig(name: string): MCPConfig[] {
  const configs = loadMCPConfigs()
  const filtered = configs.filter((c) => c.name !== name)
  saveMCPConfigs(filtered)
  return filtered
}

export function toggleMCPConfig(name: string): MCPConfig[] {
  const configs = loadMCPConfigs()
  const config = configs.find((c) => c.name === name)
  if (config) {
    config.enabled = !config.enabled
    saveMCPConfigs(configs)
  }
  return configs
}
