export type NodeStatus = "idle" | "running" | "completed" | "failed"

export interface StudioNodeData {
  label: string
  config: Record<string, string>
  status: NodeStatus
  output?: string
  error?: string
  outputLabel?: string
  [key: string]: unknown
}

export interface PaletteNode {
  type: string
  label: string
  category: string
  icon: React.ReactNode
  color: string
  description: string
  defaultConfig: Record<string, string>
}
