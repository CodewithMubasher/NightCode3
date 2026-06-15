import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Eclipse } from "lucide-react"
import type { StudioNodeData } from "../types"

export function SummarizeNode({ data }: NodeProps) {
  const d = data as unknown as StudioNodeData
  const status = d.status ?? "idle"
  const borderColor =
    status === "running" ? "border-yellow-500/60" :
    status === "completed" ? "border-green-500/60" :
    status === "failed" ? "border-red-500/60" :
    "border-white/10"

  const bgColor =
    status === "running" ? "bg-yellow-500/10" :
    status === "completed" ? "bg-green-500/10" :
    status === "failed" ? "bg-red-500/10" :
    "bg-neutral-900/80"

  const pulse = status === "running" ? "animate-pulse" : ""

  return (
    <div className={`rounded-lg border px-4 py-3 shadow-sm backdrop-blur-sm ${borderColor} ${bgColor} ${pulse} min-w-[180px]`}>
      <Handle type="target" position={Position.Top} className="!border-cyan-500 !bg-cyan-500" />
      <div className="flex items-center gap-2">
        <Eclipse size={14} className="text-cyan-400" />
        <span className="text-sm font-medium text-neutral-100">{d.label}</span>
      </div>
      {d.config.prompt && (
        <p className="mt-1 text-[11px] text-neutral-400">Prompt: {d.config.prompt}</p>
      )}
      {d.output && (
        <div className="mt-2 max-w-[240px] rounded bg-neutral-800/50 px-2 py-1.5 text-[11px] text-neutral-300">
          <span className="font-medium text-neutral-400">{d.outputLabel ?? "Output"}:</span>
          <p className="mt-0.5 line-clamp-3 leading-relaxed">{d.output}</p>
        </div>
      )}
      {d.error && (
        <div className="mt-2 rounded bg-red-900/30 px-2 py-1.5 text-[11px] text-red-300">{d.error}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!border-neutral-600 !bg-neutral-500" />
    </div>
  )
}
