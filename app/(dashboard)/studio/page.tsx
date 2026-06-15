"use client"

import { useCallback, useRef, useState } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  type OnConnect,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Play, RotateCcw, Terminal } from "lucide-react"
import { GmailNode } from "@/components/studio/nodes/gmail-node"
import { SummarizeNode } from "@/components/studio/nodes/summarize-node"
import { OutputNode } from "@/components/studio/nodes/output-node"
import { AnimatedEdge } from "@/components/studio/animated-edge"
import { NodePalette } from "@/components/studio/node-palette"
import { NodeConfig } from "@/components/studio/node-config"
import { executeWorkflow } from "@/components/studio/execution-engine"
import type { StudioNodeData } from "@/components/studio/types"

const initialNodes: Node[] = []
const initialEdges: Edge[] = []

const nodeTypes = { gmail: GmailNode, summarize: SummarizeNode, output: OutputNode }
const edgeTypes = { animated: AnimatedEdge }

function StudioCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [showPalette, setShowPalette] = useState(true)
  const [showConfig, setShowConfig] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [execLog, setExecLog] = useState<string[]>([])
  const { screenToFlowPosition } = useReactFlow()

  const log = useCallback((msg: string) => {
    setExecLog((prev) => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }, [])

  const onConnect: OnConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: "animated" }, eds)),
    [setEdges]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData("application/reactflow")
      if (!type) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const id = `${type}_${Date.now()}`
      const newNode: Node = {
        id,
        type,
        position,
        data: { label: type === "gmail" ? "Gmail" : type === "summarize" ? "AI Summarize" : "Output", config: {}, status: "idle" },
      }
      setNodes((nds) => nds.concat(newNode))
      log(`Added ${type} node`)
    },
    [screenToFlowPosition, setNodes, log]
  )

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
    setShowConfig(true)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setShowConfig(false)
  }, [])

  const updateNodeConfig = useCallback(
    (nodeId: string, config: Record<string, string>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data as Record<string, unknown>), config } } : n))
      )
      log("Updated config")
    },
    [setNodes, log]
  )

  const setEdgeAnimation = useCallback(
    (sourceNodeId: string, animated: boolean) => {
      setEdges((eds) =>
        eds.map((e) => (e.source === sourceNodeId ? { ...e, animated } : e))
      )
    },
    [setEdges]
  )

  const handleRun = useCallback(async () => {
    if (isRunning) return
    setIsRunning(true)
    setSelectedNode(null)
    setShowConfig(false)
    setExecLog([])
    log("Starting execution...")

    const snapshotNodes = nodes
    const snapshotEdges = edges
    log(`Nodes: ${snapshotNodes.length}, Edges: ${snapshotEdges.length}`)

    snapshotNodes.forEach((n) => {
      const d = n.data as StudioNodeData
      log(`  Node ${n.id}: type=${n.type}, label=${d.label}`)
    })
    snapshotEdges.forEach((e) => log(`  Edge ${e.id}: ${e.source} → ${e.target}`))

    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...(n.data as Record<string, unknown>), status: "idle", output: undefined, error: undefined, outputLabel: undefined },
      }))
    )

    try {
      await executeWorkflow(
        snapshotNodes as { id: string; type: string; data: Record<string, unknown> }[],
        snapshotEdges,
        (nodeId, status, data) => {
          log(`Event: ${nodeId} → ${status}${data?.output ? ` (${data.output.slice(0, 40)}...)` : ""}${data?.error ? ` error: ${data.error}` : ""}`)
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...(n.data as Record<string, unknown>),
                      status,
                      output: data?.output ?? (n.data as StudioNodeData).output,
                      outputLabel: data?.outputLabel ?? (n.data as StudioNodeData).outputLabel,
                      error: data?.error ?? (n.data as StudioNodeData).error,
                    },
                  }
                : n
            )
          )
          setEdgeAnimation(nodeId, status === "running")
        }
      )
      log("Execution complete")
    } catch (err) {
      log(`Execution error: ${(err as Error).message}`)
    } finally {
      setIsRunning(false)
    }
  }, [nodes, edges, isRunning, setNodes, setEdgeAnimation, log])

  const handleReset = useCallback(() => {
    setNodes([])
    setEdges([])
    setSelectedNode(null)
    setShowConfig(false)
    setExecLog([])
  }, [setNodes, setEdges])

  return (
    <div className="relative flex h-full w-full">
      {showPalette && (
        <div className="absolute left-2 top-2 z-10 flex h-[calc(100%-16px)] w-48 flex-col overflow-y-auto rounded-lg border border-white/10 bg-neutral-900/90 shadow-lg backdrop-blur-sm">
          <NodePalette />
        </div>
      )}

      <div ref={reactFlowWrapper} className="h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          colorMode="dark"
          fitView
          selectionOnDrag
          panOnScroll
          zoomOnDoubleClick={false}
          defaultEdgeOptions={{ type: "animated" }}
        >
          <Background />
          <Controls />
          <MiniMap />
          <Panel position="top-center" className="flex items-center gap-2">
            <button
              onClick={() => setShowPalette((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-900/80 px-3 py-1.5 text-xs text-neutral-400 shadow-sm backdrop-blur-sm transition-colors hover:text-neutral-200"
            >
              <Terminal size={14} />
              Nodes
            </button>
            <button
              onClick={handleRun}
              disabled={isRunning || nodes.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-600/20 px-4 py-1.5 text-xs font-medium text-emerald-400 shadow-sm backdrop-blur-sm transition-colors hover:bg-emerald-600/30 disabled:opacity-50"
            >
              <Play size={12} />
              {isRunning ? "Running..." : "Run"}
            </button>
            <button
              onClick={handleReset}
              disabled={nodes.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-900/80 px-3 py-1.5 text-xs text-neutral-400 shadow-sm backdrop-blur-sm transition-colors hover:text-neutral-200 disabled:opacity-50"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </Panel>

          {execLog.length > 0 && (
            <Panel position="bottom-left" className="max-w-xs">
              <div className="rounded-lg border border-white/10 bg-neutral-950/90 px-3 py-2 shadow-lg backdrop-blur-sm">
                <p className="mb-1 text-[10px] font-medium text-neutral-500">EXECUTION LOG</p>
                <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
                  {execLog.map((msg, i) => (
                    <p key={i} className="text-[10px] leading-tight text-neutral-400">{msg}</p>
                  ))}
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {showConfig && selectedNode && (
        <div className="absolute right-2 top-2 z-10 h-[calc(100%-16px)] w-56 overflow-y-auto rounded-lg border border-white/10 bg-neutral-900/90 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-xs font-medium text-neutral-400">Configure</span>
            <button onClick={() => setShowConfig(false)} className="text-neutral-500 hover:text-neutral-300">
              <Terminal size={14} />
            </button>
          </div>
          <NodeConfig node={selectedNode} onUpdate={updateNodeConfig} onClose={() => setShowConfig(false)} />
        </div>
      )}

      {nodes.length === 0 && !showPalette && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-neutral-600">
            <Terminal size={32} />
            <p className="text-sm">Open the node palette to start building</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AgentStudioPage() {
  return (
    <ReactFlowProvider>
      <StudioCanvas />
    </ReactFlowProvider>
  )
}
