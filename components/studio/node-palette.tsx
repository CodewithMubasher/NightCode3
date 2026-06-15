import { useCallback } from "react"
import { Mail, Eclipse, Eye, type LucideIcon } from "lucide-react"
import type { PaletteNode } from "./types"

const paletteGroups: { category: string; icon: LucideIcon; nodes: PaletteNode[] }[] = [
  {
    category: "Email",
    icon: Mail,
    nodes: [
      {
        type: "gmail",
        label: "Gmail",
        category: "Email",
        icon: <Mail size={14} />,
        color: "#D93025",
        description: "Read emails from Gmail",
        defaultConfig: { query: "", maxResults: "1" },
      },
    ],
  },
  {
    category: "AI",
    icon: Eclipse,
    nodes: [
      {
        type: "summarize",
        label: "AI Summarize",
        category: "AI",
        icon: <Eclipse size={14} />,
        color: "#06b6d4",
        description: "Summarize text using AI",
        defaultConfig: { prompt: "Summarize the key points" },
      },
      {
        type: "output",
        label: "Output",
        category: "AI",
        icon: <Eye size={14} />,
        color: "#a855f7",
        description: "Display the final result",
        defaultConfig: {},
      },
    ],
  },
]

export function NodePalette() {
  const onDragStart = useCallback(
    (event: React.DragEvent, node: PaletteNode) => {
      event.dataTransfer.setData("application/reactflow", node.type)
      event.dataTransfer.setData("application/json", JSON.stringify(node))
      event.dataTransfer.effectAllowed = "move"
    },
    []
  )

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="px-3 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Nodes</h3>
      </div>
      {paletteGroups.map((group) => (
        <div key={group.category}>
          <div className="mb-1.5 flex items-center gap-1.5 px-3">
            <group.icon size={12} className="text-neutral-500" />
            <span className="text-[11px] font-medium text-neutral-500">{group.category}</span>
          </div>
          <div className="flex flex-col gap-1 px-2">
            {group.nodes.map((node) => (
              <div
                key={node.type}
                draggable
                onDragStart={(e) => onDragStart(e, node)}
                className="flex cursor-grab items-center gap-2.5 rounded-md border border-white/5 bg-neutral-800/50 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-white/20 hover:bg-neutral-700/50 active:cursor-grabbing"
              >
                <span style={{ color: node.color }}>{node.icon}</span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-200">{node.label}</span>
                  <span className="text-[10px] text-neutral-500">{node.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
