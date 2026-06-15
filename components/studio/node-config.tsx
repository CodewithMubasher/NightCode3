import { useState, useEffect } from "react"
import { X } from "lucide-react"
import type { Node } from "@xyflow/react"
import type { StudioNodeData } from "./types"

interface NodeConfigProps {
  node: Node | null
  onUpdate: (nodeId: string, config: Record<string, string>) => void
  onClose: () => void
}

const configFields: Record<string, { key: string; label: string; placeholder: string }[]> = {
  gmail: [
    { key: "query", label: "Search Query", placeholder: "from:alice is:unread" },
    { key: "maxResults", label: "Max Results", placeholder: "1" },
  ],
  summarize: [
    { key: "prompt", label: "Prompt", placeholder: "Summarize the key points" },
  ],
  output: [],
}

export function NodeConfig({ node, onUpdate, onClose }: NodeConfigProps) {
  const [localConfig, setLocalConfig] = useState<Record<string, string>>({})

  useEffect(() => {
    if (node) {
      setLocalConfig({ ...((node.data as StudioNodeData).config ?? {}) })
    }
  }, [node])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-xs text-neutral-500">Select a node to configure</p>
      </div>
    )
  }

  const d = node.data as StudioNodeData
  const fields = configFields[node.type ?? ""] ?? []

  const handleChange = (key: string, value: string) => {
    const next = { ...localConfig, [key]: value }
    setLocalConfig(next)
    onUpdate(node.id, next)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-medium text-neutral-200">{d.label}</h3>
        <button onClick={onClose} className="rounded p-0.5 text-neutral-500 hover:text-neutral-300">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {fields.length === 0 ? (
          <p className="text-xs text-neutral-500">No configuration needed</p>
        ) : (
          <div className="flex flex-col gap-3">
            {fields.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-[11px] font-medium text-neutral-400">{field.label}</label>
                <input
                  type="text"
                  value={localConfig[field.key] ?? ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-md border border-white/10 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
