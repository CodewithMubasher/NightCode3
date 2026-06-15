import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Eye, CheckCircle2, Loader2, AlertCircle } from "lucide-react"

export function OutputNode({ data }: NodeProps) {
  const d = data as { label?: string; status?: string; output?: string; error?: string }
  const status = d.status ?? "idle"

  return (
    <div className="w-72 rounded-xl border border-white/10 bg-neutral-900/80 shadow-sm backdrop-blur-sm">
      <Handle type="target" position={Position.Top} className="!border-purple-500 !bg-purple-500" />
      <div className="border-b border-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-purple-400" />
          <span className="text-sm font-medium text-neutral-100">{d.label ?? "Output"}</span>
        </div>
      </div>
      <div className="px-4 py-3">
        {status === "running" && (
          <div className="flex items-center gap-2 text-yellow-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Processing...</span>
          </div>
        )}
        {status === "completed" && d.output && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-green-400" />
              <span className="text-[11px] font-medium text-green-400">Complete</span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg bg-neutral-800/60 p-2.5">
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-200">{d.output}</p>
            </div>
          </div>
        )}
        {status === "failed" && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <AlertCircle size={12} className="text-red-400" />
              <span className="text-[11px] font-medium text-red-400">Error</span>
            </div>
            <div className="rounded-lg bg-red-900/20 p-2.5 text-[11px] text-red-300">{d.error ?? "Unknown error"}</div>
          </div>
        )}
        {status === "idle" && !d.output && (
          <div className="flex flex-col items-center gap-1.5 py-4 text-neutral-500">
            <Eye size={20} />
            <p className="text-xs">Connect and run</p>
          </div>
        )}
      </div>
    </div>
  )
}
