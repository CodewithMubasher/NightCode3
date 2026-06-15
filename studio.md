# Agent Studio — Complete Implementation Plan

---

## 0. Mental Model First

Agent Studio is not a new app. It's a **new page inside NightCode** that reuses your existing engine. The canvas is the UI. MCP servers are the actuators. Your existing tool harness is the executor. You're building the **visual layer on top of what already works**.

---

## 1. File Structure

```
app/
  agent-studio/
    page.tsx                    ← route entry point
    layout.tsx                  ← wraps with sidebar, no chat UI

components/
  agent-studio/
    studio-canvas.tsx           ← React Flow canvas wrapper
    node-palette.tsx            ← left panel, draggable node list
    config-panel.tsx            ← right panel, selected node config
    studio-toolbar.tsx          ← top bar: run, save, schedule, AI gen
    execution-overlay.tsx       ← status badges on nodes during run
    workflow-name-input.tsx     ← inline editable title in toolbar

    nodes/
      base-node.tsx             ← shared Node wrapper (status ring, header, handles)
      trigger-node.tsx          ← manual, scheduled, webhook
      email-node.tsx            ← Gmail MCP actions
      browser-node.tsx          ← Playwright actions
      windows-node.tsx          ← win-control-mcp actions
      ai-node.tsx               ← LLM call (any provider)
      image-node.tsx            ← Pollinations image/video gen
      excel-node.tsx            ← excel-mcp actions
      obsidian-node.tsx         ← obsidian-mcp actions
      logic-node.tsx            ← if/else, loop, delay, merge
      output-node.tsx           ← display result, write file, send message

    edges/
      animated-edge.tsx         ← active data flow visualization
      conditional-edge.tsx      ← dashed, for true/false branches

    panels/
      ai-generate-panel.tsx     ← natural language → workflow generator
      schedule-panel.tsx        ← cron builder UI
      template-browser.tsx      ← saved/built-in workflow templates

lib/
  agent-studio/
    types.ts                    ← WorkflowNode, WorkflowEdge, Workflow, ExecutionState
    executor.ts                 ← workflow runner (calls your existing tool harness)
    scheduler.ts                ← cron job manager
    workflow-store.ts           ← Zustand store
    node-registry.ts            ← maps node types → metadata + default config
    ai-generator.ts             ← LLM call that returns node/edge JSON
    storage.ts                  ← save/load from localStorage + file export
```

---

## 2. Type System

Define these first. Everything else depends on them.

```typescript
// lib/agent-studio/types.ts

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'skipped'

export type NodeCategory =
  | 'trigger'
  | 'email'
  | 'browser'
  | 'windows'
  | 'ai'
  | 'media'
  | 'files'
  | 'logic'
  | 'output'

export interface NodePort {
  id: string
  label: string
  type: 'data' | 'control'
}

export interface WorkflowNodeData {
  label: string
  category: NodeCategory
  mcpServer?: string          // which MCP server handles this
  action: string              // the specific tool/action name
  config: Record<string, unknown>  // node-specific parameters
  status: NodeStatus
  result?: unknown            // last execution output
  error?: string
  inputs: NodePort[]
  outputs: NodePort[]
}

export interface WorkflowNode {
  id: string
  type: string                // matches React Flow node type key
  position: { x: number; y: number }
  data: WorkflowNodeData
}

export interface WorkflowEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  type: 'animated' | 'conditional'
  label?: string              // 'true' | 'false' for logic branches
  animated: boolean
  data?: {
    active: boolean           // is data flowing through this edge right now?
  }
}

export interface Workflow {
  id: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: number
  updatedAt: number
  schedule?: {
    enabled: boolean
    cron: string
    lastRun?: number
    nextRun?: number
  }
}

export interface ExecutionState {
  workflowId: string
  status: 'idle' | 'running' | 'completed' | 'failed'
  currentNodeId?: string
  nodeStatuses: Record<string, NodeStatus>
  nodeResults: Record<string, unknown>
  nodeErrors: Record<string, string>
  startedAt?: number
  completedAt?: number
  logs: ExecutionLog[]
}

export interface ExecutionLog {
  timestamp: number
  nodeId: string
  nodeLabel: string
  level: 'info' | 'success' | 'error'
  message: string
}
```

---

## 3. Zustand Store

```typescript
// lib/agent-studio/workflow-store.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyNodeChanges, applyEdgeChanges } from 'reactflow'
import type { Workflow, WorkflowNode, WorkflowEdge, ExecutionState } from './types'

interface WorkflowStore {
  // Workflow library
  workflows: Workflow[]
  activeWorkflowId: string | null

  // Canvas state (for active workflow)
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]

  // Execution
  execution: ExecutionState | null
  isRunning: boolean

  // UI state
  selectedNodeId: string | null
  isPaletteOpen: boolean
  isConfigPanelOpen: boolean
  isAIGeneratorOpen: boolean

  // Workflow CRUD
  createWorkflow: (name: string) => string
  loadWorkflow: (id: string) => void
  saveWorkflow: () => void
  deleteWorkflow: (id: string) => void
  duplicateWorkflow: (id: string) => void

  // Canvas mutations
  onNodesChange: (changes: any) => void
  onEdgesChange: (changes: any) => void
  onConnect: (connection: any) => void
  addNode: (node: WorkflowNode) => void
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void

  // Execution
  startExecution: () => Promise<void>
  stopExecution: () => void
  updateNodeStatus: (nodeId: string, status: NodeStatus, result?: unknown, error?: string) => void
  appendLog: (log: ExecutionLog) => void

  // UI
  selectNode: (id: string | null) => void
  setAIGeneratorOpen: (open: boolean) => void

  // Import/Export
  exportWorkflow: (id: string) => string
  importWorkflow: (json: string) => void
}
```

Key design decisions:
- Active workflow's nodes/edges live at top level (not nested inside `workflows[]`) for React Flow compatibility
- `saveWorkflow` syncs top-level nodes/edges back into `workflows[]` by `activeWorkflowId`
- Persist entire store to localStorage under key `nightcode-agent-studio`

---

## 4. Node Registry

This is the source of truth for what nodes exist, their icons, default configs, and which MCP server they use.

```typescript
// lib/agent-studio/node-registry.ts

export interface NodeDefinition {
  type: string                 // unique React Flow type key
  category: NodeCategory
  label: string
  description: string
  icon: string                 // lucide icon name
  mcpServer?: string
  action: string               // MCP tool name OR internal action
  defaultConfig: Record<string, unknown>
  configSchema: ConfigField[]  // drives the config panel form
  inputs: NodePort[]
  outputs: NodePort[]
}

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number' | 'toggle' | 'variable-ref'
  placeholder?: string
  options?: { label: string; value: string }[]
  required?: boolean
  description?: string
}

export const NODE_REGISTRY: NodeDefinition[] = [
  // TRIGGERS
  {
    type: 'trigger-manual',
    category: 'trigger',
    label: 'Manual Trigger',
    description: 'Start workflow manually',
    icon: 'Play',
    action: 'trigger:manual',
    defaultConfig: {},
    configSchema: [],
    inputs: [],
    outputs: [{ id: 'out', label: 'Start', type: 'control' }],
  },
  {
    type: 'trigger-schedule',
    category: 'trigger',
    label: 'Schedule',
    description: 'Run on a cron schedule',
    icon: 'Clock',
    action: 'trigger:schedule',
    defaultConfig: { cron: '0 9 * * *' },
    configSchema: [
      { key: 'cron', label: 'Cron expression', type: 'text', placeholder: '0 9 * * *' },
    ],
    inputs: [],
    outputs: [{ id: 'out', label: 'Fire', type: 'control' }],
  },

  // EMAIL
  {
    type: 'email-read',
    category: 'email',
    label: 'Read Emails',
    description: 'Fetch emails matching a query',
    icon: 'Mail',
    mcpServer: 'gmail-mcp',
    action: 'search_emails',
    defaultConfig: { query: '', maxResults: 10 },
    configSchema: [
      { key: 'query', label: 'Search query', type: 'text', placeholder: 'from:boss@company.com' },
      { key: 'maxResults', label: 'Max results', type: 'number' },
    ],
    inputs: [{ id: 'in', label: 'Trigger', type: 'control' }],
    outputs: [
      { id: 'emails', label: 'Emails', type: 'data' },
      { id: 'done', label: 'Done', type: 'control' },
    ],
  },
  {
    type: 'email-send',
    category: 'email',
    label: 'Send Email',
    description: 'Send an email via Gmail',
    icon: 'Send',
    mcpServer: 'gmail-mcp',
    action: 'send_email',
    defaultConfig: { to: '', subject: '', body: '' },
    configSchema: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'recipient@email.com' },
      { key: 'subject', label: 'Subject', type: 'text' },
      { key: 'body', label: 'Body', type: 'textarea' },
    ],
    inputs: [
      { id: 'in', label: 'Trigger', type: 'control' },
      { id: 'body', label: 'Body (dynamic)', type: 'data' },
    ],
    outputs: [{ id: 'done', label: 'Sent', type: 'control' }],
  },

  // BROWSER
  {
    type: 'browser-navigate',
    category: 'browser',
    label: 'Navigate',
    description: 'Open a URL in browser',
    icon: 'Globe',
    mcpServer: 'playwright',
    action: 'navigate',
    defaultConfig: { url: '' },
    configSchema: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com' },
    ],
    inputs: [{ id: 'in', label: 'Trigger', type: 'control' }],
    outputs: [
      { id: 'done', label: 'Loaded', type: 'control' },
      { id: 'page', label: 'Page', type: 'data' },
    ],
  },
  {
    type: 'browser-scrape',
    category: 'browser',
    label: 'Scrape Page',
    description: 'Extract content from current page',
    icon: 'Code',
    mcpServer: 'playwright',
    action: 'get_page_content',
    defaultConfig: { selector: 'body' },
    configSchema: [
      { key: 'selector', label: 'CSS selector', type: 'text', placeholder: '.article-body' },
    ],
    inputs: [{ id: 'in', label: 'Trigger', type: 'control' }],
    outputs: [
      { id: 'content', label: 'Content', type: 'data' },
      { id: 'done', label: 'Done', type: 'control' },
    ],
  },

  // AI
  {
    type: 'ai-prompt',
    category: 'ai',
    label: 'AI Prompt',
    description: 'Send a prompt to an LLM',
    icon: 'Sparkles',
    action: 'ai:prompt',
    defaultConfig: { model: 'groq:llama-3.3-70b', systemPrompt: '', userPrompt: '' },
    configSchema: [
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { label: 'Llama 3.3 70B (Groq)', value: 'groq:llama-3.3-70b' },
          { label: 'Gemini 2.0 Flash', value: 'gemini:gemini-2.0-flash' },
          { label: 'Gemini 1.5 Pro', value: 'gemini:gemini-1.5-pro' },
        ],
      },
      { key: 'systemPrompt', label: 'System prompt', type: 'textarea' },
      { key: 'userPrompt', label: 'User prompt', type: 'textarea', description: 'Use {{variable}} to reference previous node outputs' },
    ],
    inputs: [
      { id: 'in', label: 'Trigger', type: 'control' },
      { id: 'context', label: 'Context', type: 'data' },
    ],
    outputs: [
      { id: 'response', label: 'Response', type: 'data' },
      { id: 'done', label: 'Done', type: 'control' },
    ],
  },

  // LOGIC
  {
    type: 'logic-condition',
    category: 'logic',
    label: 'If / Else',
    description: 'Branch based on a condition',
    icon: 'GitBranch',
    action: 'logic:condition',
    defaultConfig: { condition: '', operator: 'contains', value: '' },
    configSchema: [
      { key: 'condition', label: 'Input to check', type: 'variable-ref' },
      {
        key: 'operator',
        label: 'Operator',
        type: 'select',
        options: [
          { label: 'contains', value: 'contains' },
          { label: 'equals', value: 'equals' },
          { label: 'is empty', value: 'isEmpty' },
          { label: 'greater than', value: 'gt' },
        ],
      },
      { key: 'value', label: 'Value', type: 'text' },
    ],
    inputs: [
      { id: 'in', label: 'Trigger', type: 'control' },
      { id: 'data', label: 'Data', type: 'data' },
    ],
    outputs: [
      { id: 'true', label: 'True', type: 'control' },
      { id: 'false', label: 'False', type: 'control' },
    ],
  },
  {
    type: 'logic-delay',
    category: 'logic',
    label: 'Delay',
    description: 'Wait before continuing',
    icon: 'Timer',
    action: 'logic:delay',
    defaultConfig: { ms: 1000 },
    configSchema: [
      { key: 'ms', label: 'Delay (ms)', type: 'number' },
    ],
    inputs: [{ id: 'in', label: 'Trigger', type: 'control' }],
    outputs: [{ id: 'done', label: 'Done', type: 'control' }],
  },

  // OUTPUT
  {
    type: 'output-display',
    category: 'output',
    label: 'Show Result',
    description: 'Display data in the output panel',
    icon: 'Eye',
    action: 'output:display',
    defaultConfig: { label: 'Result' },
    configSchema: [
      { key: 'label', label: 'Label', type: 'text' },
    ],
    inputs: [
      { id: 'in', label: 'Trigger', type: 'control' },
      { id: 'data', label: 'Data', type: 'data' },
    ],
    outputs: [],
  },
]

export const NODE_CATEGORIES: { id: NodeCategory; label: string; icon: string }[] = [
  { id: 'trigger', label: 'Triggers', icon: 'Zap' },
  { id: 'email', label: 'Email', icon: 'Mail' },
  { id: 'browser', label: 'Browser', icon: 'Globe' },
  { id: 'windows', label: 'Windows', icon: 'Monitor' },
  { id: 'ai', label: 'AI', icon: 'Sparkles' },
  { id: 'media', label: 'Media', icon: 'Image' },
  { id: 'files', label: 'Files', icon: 'FileText' },
  { id: 'logic', label: 'Logic', icon: 'GitBranch' },
  { id: 'output', label: 'Output', icon: 'Eye' },
]
```

---

## 5. Executor

This is the core engine. It takes a workflow, walks the graph, and calls your existing MCP/tool harness for each node.

```typescript
// lib/agent-studio/executor.ts

import type { Workflow, WorkflowNode, ExecutionState } from './types'

export class WorkflowExecutor {
  private workflow: Workflow
  private onNodeStatusChange: (nodeId: string, status: NodeStatus, result?: unknown, error?: string) => void
  private onEdgeActivate: (edgeId: string, active: boolean) => void
  private onLog: (log: ExecutionLog) => void
  private abortController: AbortController
  private context: Record<string, unknown> = {}  // node outputs keyed by nodeId

  constructor(
    workflow: Workflow,
    callbacks: {
      onNodeStatusChange: typeof this.onNodeStatusChange
      onEdgeActivate: typeof this.onEdgeActivate
      onLog: typeof this.onLog
    }
  ) {
    this.workflow = workflow
    this.onNodeStatusChange = callbacks.onNodeStatusChange
    this.onEdgeActivate = callbacks.onEdgeActivate
    this.onLog = callbacks.onLog
    this.abortController = new AbortController()
  }

  async run() {
    // 1. Find trigger node (node with no incoming control edges)
    const triggerNode = this.findTriggerNode()
    if (!triggerNode) throw new Error('No trigger node found')

    // 2. Walk the graph from trigger
    await this.executeNode(triggerNode)
  }

  stop() {
    this.abortController.abort()
  }

  private findTriggerNode(): WorkflowNode | undefined {
    const nodesWithIncomingEdges = new Set(
      this.workflow.edges
        .filter(e => e.targetHandle === 'in')
        .map(e => e.target)
    )
    return this.workflow.nodes.find(n => !nodesWithIncomingEdges.has(n.id))
  }

  private async executeNode(node: WorkflowNode) {
    if (this.abortController.signal.aborted) return

    // Set status to running
    this.onNodeStatusChange(node.id, 'running')
    this.onLog({ timestamp: Date.now(), nodeId: node.id, nodeLabel: node.data.label, level: 'info', message: `Running ${node.data.label}...` })

    try {
      const result = await this.executeAction(node)

      // Store result in context for downstream nodes
      this.context[node.id] = result

      this.onNodeStatusChange(node.id, 'completed', result)
      this.onLog({ timestamp: Date.now(), nodeId: node.id, nodeLabel: node.data.label, level: 'success', message: `${node.data.label} completed` })

      // Find next nodes via control edges
      await this.walkControlEdges(node.id, result)

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.onNodeStatusChange(node.id, 'failed', undefined, message)
      this.onLog({ timestamp: Date.now(), nodeId: node.id, nodeLabel: node.data.label, level: 'error', message })
    }
  }

  private async walkControlEdges(fromNodeId: string, result: unknown) {
    // Find all outgoing control edges from this node
    const outEdges = this.workflow.edges.filter(
      e => e.source === fromNodeId && e.sourceHandle !== 'data'
    )

    for (const edge of outEdges) {
      // For conditional edges, check the label matches the result
      if (edge.type === 'conditional') {
        const conditionMet = this.evaluateCondition(edge.label, result)
        if (!conditionMet) continue
      }

      // Animate this edge
      this.onEdgeActivate(edge.id, true)
      await delay(400)  // visual feedback pause
      this.onEdgeActivate(edge.id, false)

      // Find and execute the target node
      const targetNode = this.workflow.nodes.find(n => n.id === edge.target)
      if (targetNode) {
        await this.executeNode(targetNode)
      }
    }
  }

  private async executeAction(node: WorkflowNode): Promise<unknown> {
    const { action, config, mcpServer } = node.data
    const resolvedConfig = this.resolveVariables(config)

    // Route to the right handler
    if (action.startsWith('trigger:')) return this.executeTrigger(action, resolvedConfig)
    if (action.startsWith('logic:')) return this.executeLogic(action, resolvedConfig, node)
    if (action.startsWith('ai:')) return this.executeAI(action, resolvedConfig, node)
    if (action.startsWith('output:')) return this.executeOutput(action, resolvedConfig, node)
    if (mcpServer) return this.executeMCPTool(mcpServer, action, resolvedConfig)

    throw new Error(`Unknown action: ${action}`)
  }

  private resolveVariables(config: Record<string, unknown>): Record<string, unknown> {
    // Replace {{nodeId.field}} or {{nodeId}} with actual context values
    const resolved: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        resolved[key] = value.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
          const [nodeId, field] = path.split('.')
          const nodeResult = this.context[nodeId]
          if (field && typeof nodeResult === 'object' && nodeResult !== null) {
            return String((nodeResult as Record<string, unknown>)[field] ?? '')
          }
          return String(nodeResult ?? '')
        })
      } else {
        resolved[key] = value
      }
    }
    return resolved
  }

  private async executeMCPTool(server: string, tool: string, params: Record<string, unknown>) {
    // Call your existing MCP infrastructure
    // This plugs into whatever your current MCP client looks like
    const response = await fetch('/api/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server, tool, params }),
      signal: this.abortController.signal,
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }

  private async executeAI(action: string, config: Record<string, unknown>, node: WorkflowNode) {
    // Use your existing multi-provider AI harness
    const response = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        systemPrompt: config.systemPrompt,
        userPrompt: config.userPrompt,
        context: this.getIncomingData(node.id),
      }),
      signal: this.abortController.signal,
    })
    if (!response.ok) throw new Error(await response.text())
    const data = await response.json()
    return data.content
  }

  private getIncomingData(nodeId: string): unknown {
    // Find all nodes connected to data inputs of this node
    const dataEdges = this.workflow.edges.filter(
      e => e.target === nodeId && e.targetHandle === 'context'
    )
    const results = dataEdges.map(e => this.context[e.source]).filter(Boolean)
    return results.length === 1 ? results[0] : results
  }

  private evaluateCondition(label: string | undefined, result: unknown): boolean {
    // 'true' / 'false' labels on conditional edges
    if (label === 'true') return Boolean(result)
    if (label === 'false') return !Boolean(result)
    return true
  }

  private async executeTrigger(action: string, config: Record<string, unknown>) {
    return { triggered: true, timestamp: Date.now(), config }
  }

  private async executeLogic(action: string, config: Record<string, unknown>, node: WorkflowNode) {
    if (action === 'logic:delay') {
      await delay(Number(config.ms) || 1000)
      return null
    }
    if (action === 'logic:condition') {
      const input = this.getIncomingData(node.id)
      const inputStr = String(input ?? '')
      const value = String(config.value ?? '')
      switch (config.operator) {
        case 'contains': return inputStr.includes(value)
        case 'equals': return inputStr === value
        case 'isEmpty': return !inputStr
        case 'gt': return Number(inputStr) > Number(value)
        default: return false
      }
    }
    return null
  }

  private async executeOutput(action: string, config: Record<string, unknown>, node: WorkflowNode) {
    const data = this.getIncomingData(node.id)
    // Emit to the execution results panel via SSE or callback
    return { label: config.label, data }
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
```

---

## 6. Page Layout

```typescript
// app/agent-studio/page.tsx

export default function AgentStudioPage() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Left: Node Palette — fixed 240px */}
      <NodePalette />

      {/* Center: Canvas — fills remaining space */}
      <div className="flex flex-col flex-1 min-w-0">
        <StudioToolbar />
        <StudioCanvas />
      </div>

      {/* Right: Config Panel — fixed 300px, slides in when node selected */}
      <ConfigPanel />
    </div>
  )
}
```

The existing NightCode sidebar renders on the left of this whole layout via the root layout. Agent Studio's own NodePalette is a secondary left panel inside the page.

---

## 7. Component Specs

### `StudioToolbar`
- Left: workflow name (inline editable `<input>`)
- Center: Run button (green, shows spinner during execution), Stop button (appears when running)
- Right: AI Generate button, Schedule button, Save button, Export button
- Below the buttons: execution status breadcrumb — "Idle" / "Running node 3/7" / "Completed in 4.2s" / "Failed at Send Email"

### `NodePalette`
- Top: search input
- Below: categories as collapsible sections
- Each node: small card with icon + label + description. Draggable via HTML5 drag or React Flow's `onDragStart` handler
- Drag sets `event.dataTransfer.setData('nodeType', def.type)`

```typescript
// How drop works on canvas
const onDrop = useCallback((event: DragEvent) => {
  event.preventDefault()
  const nodeType = event.dataTransfer.getData('nodeType')
  const def = NODE_REGISTRY.find(d => d.type === nodeType)
  if (!def) return

  const position = reactFlowInstance.screenToFlowPosition({
    x: event.clientX,
    y: event.clientY,
  })

  const newNode: WorkflowNode = {
    id: `${nodeType}-${Date.now()}`,
    type: nodeType,
    position,
    data: {
      ...def,
      status: 'idle',
      config: { ...def.defaultConfig },
    },
  }

  addNode(newNode)
  selectNode(newNode.id)
}, [reactFlowInstance, addNode, selectNode])
```

### `BaseNode`

Every node renders through this wrapper. It handles the status ring, header, and handles.

```typescript
// components/agent-studio/nodes/base-node.tsx

interface BaseNodeProps {
  id: string
  data: WorkflowNodeData
  selected: boolean
  children?: React.ReactNode
}

const STATUS_COLORS = {
  idle: 'border-border',
  running: 'border-blue-500 shadow-blue-500/20 shadow-lg',
  completed: 'border-green-500',
  failed: 'border-red-500',
  skipped: 'border-muted',
}

const STATUS_RING_ANIMATION = {
  running: 'animate-pulse',
}

export function BaseNode({ id, data, selected, children }: BaseNodeProps) {
  const Icon = getIcon(data.icon)

  return (
    <div className={cn(
      'min-w-[200px] rounded-lg border-2 bg-card transition-all duration-200',
      STATUS_COLORS[data.status],
      selected && 'ring-2 ring-primary ring-offset-2',
      data.status === 'running' && 'animate-pulse',
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className={cn('p-1 rounded', CATEGORY_BG[data.category])}>
          <Icon size={14} />
        </div>
        <span className="text-sm font-medium flex-1">{data.label}</span>
        <StatusIndicator status={data.status} />
      </div>

      {/* Content */}
      {children && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {children}
        </div>
      )}

      {/* Result preview (when completed) */}
      {data.status === 'completed' && data.result && (
        <div className="px-3 py-1 border-t border-border bg-green-500/5">
          <p className="text-xs text-green-600 truncate">
            ✓ {JSON.stringify(data.result).slice(0, 60)}
          </p>
        </div>
      )}

      {/* Error preview (when failed) */}
      {data.status === 'failed' && data.error && (
        <div className="px-3 py-1 border-t border-border bg-red-500/5">
          <p className="text-xs text-red-600 truncate">✗ {data.error}</p>
        </div>
      )}

      {/* Input handles */}
      {data.inputs.map((port, i) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{ top: 40 + i * 20 }}
          className="w-3 h-3 border-2 border-border bg-background"
        />
      ))}

      {/* Output handles */}
      {data.outputs.map((port, i) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{ top: 40 + i * 20 }}
          className="w-3 h-3 border-2 border-border bg-background"
        />
      ))}
    </div>
  )
}
```

### `ConfigPanel`

Renders the right panel when a node is selected. Driven entirely by the selected node's `configSchema`.

```typescript
export function ConfigPanel() {
  const { selectedNodeId, nodes, updateNodeConfig } = useWorkflowStore()
  const node = nodes.find(n => n.id === selectedNodeId)

  if (!node) return (
    <div className="w-[300px] border-l border-border p-6 flex items-center justify-center">
      <p className="text-muted-foreground text-sm">Select a node to configure it</p>
    </div>
  )

  const def = NODE_REGISTRY.find(d => d.type === node.type)
  if (!def) return null

  return (
    <div className="w-[300px] border-l border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold">{node.data.label}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {def.configSchema.map(field => (
          <ConfigField
            key={field.key}
            field={field}
            value={node.data.config[field.key]}
            onChange={(value) => updateNodeConfig(node.id, { ...node.data.config, [field.key]: value })}
            nodeContext={nodes}   // for variable-ref fields: show available outputs
          />
        ))}
      </div>

      {/* Node I/O reference */}
      <div className="p-4 border-t border-border">
        <p className="text-xs font-medium mb-2">Outputs from this node</p>
        {def.outputs.map(port => (
          <div key={port.id} className="flex items-center gap-2 text-xs text-muted-foreground">
            <code className="bg-muted px-1 rounded">{`{{${node.id}.${port.id}}}`}</code>
            <span>{port.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## 8. AI Workflow Generator

```typescript
// lib/agent-studio/ai-generator.ts

const SYSTEM_PROMPT = `
You are an automation workflow designer for NightCode Agent Studio.
Given a natural language description, generate a JSON workflow with nodes and edges.

Available node types and their actions:
${NODE_REGISTRY.map(n => `- ${n.type}: ${n.description}`).join('\n')}

Return ONLY valid JSON in this exact format:
{
  "name": "workflow name",
  "description": "what this does",
  "nodes": [
    {
      "id": "node_1",
      "type": "trigger-manual",
      "position": { "x": 100, "y": 200 },
      "data": {
        "config": {}
      }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_1",
      "sourceHandle": "out",
      "target": "node_2",
      "targetHandle": "in",
      "type": "animated"
    }
  ]
}

Layout rules:
- Place trigger at x:100, y:200
- Each subsequent node: x += 280
- Branch nodes: offset y by ±150
- Positions must not overlap (min 200px apart)
`

export async function generateWorkflowFromPrompt(description: string): Promise<Partial<Workflow>> {
  const response = await fetch('/api/ai/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'groq:llama-3.3-70b',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: description,
    }),
  })

  const data = await response.json()
  const content = data.content as string

  // Parse the JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI did not return valid JSON')

  const parsed = JSON.parse(jsonMatch[0])

  // Merge with full node definitions from registry
  parsed.nodes = parsed.nodes.map((n: Partial<WorkflowNode>) => {
    const def = NODE_REGISTRY.find(d => d.type === n.type)
    if (!def) return n
    return {
      ...n,
      data: {
        label: def.label,
        category: def.category,
        action: def.action,
        mcpServer: def.mcpServer,
        icon: def.icon,
        status: 'idle',
        inputs: def.inputs,
        outputs: def.outputs,
        config: { ...def.defaultConfig, ...(n.data?.config ?? {}) },
      },
    }
  })

  return parsed
}
```

---

## 9. Phase Rollout

### Phase 1 — Manual Canvas (2–3 weeks)

Ship these in order:

1. File structure + types + node registry (2 days)
2. Zustand store (1 day)
3. Basic canvas with React Flow + drag from palette (2 days)
4. `BaseNode` component — all nodes render through it (1 day)
5. `ConfigPanel` with form fields (2 days)
6. Executor — run logic/delay/output nodes only, no MCP yet (2 days)
7. Status visualization — node rings, edge animation (1 day)
8. Save/load to localStorage (1 day)

**Milestone**: drag nodes, connect them, run a delay→display workflow, see it execute.

### Phase 2 — MCP Integration (1–2 weeks)

1. Wire `/api/mcp/call` endpoint to your existing MCP infrastructure (2 days)
2. Test email-read → ai-prompt → email-send pipeline (2 days)
3. Variable resolution with `{{nodeId.field}}` (1 day)
4. Execution log panel (1 day)
5. AI generator panel (2 days)

**Milestone**: describe "check my Gmail for urgent emails and summarize them" → AI builds the workflow → run it.

### Phase 3 — Scheduling + Templates (1 week)

1. Cron scheduler using `node-cron` or Vercel cron (2 days)
2. Template library with 5–10 built-in workflows (2 days)
3. Import/export as JSON file (1 day)
4. Workflow run history (1 day)

---

## 10. Critical Implementation Notes

**Don't build a new execution engine.** Your existing AI harness already calls MCP tools. The executor above is just a graph walker that calls the same endpoints your chat UI calls — but in sequence, driven by the canvas.

**Variable resolution is the hard part.** The `{{nodeId.output}}` system is what makes nodes composable. Get this right in Phase 1 even if you only test it with mock data.

**React Flow node types must be stable.** Define `nodeTypes` object outside the component or wrap in `useMemo`. If you define it inline, React Flow re-registers on every render and resets positions.

```typescript
// DO THIS
const nodeTypes = useMemo(() => ({
  'trigger-manual': (props) => <BaseNode {...props} />,
  'email-read': (props) => <BaseNode {...props} />,
  // ...
}), [])
```

**Execution must be abortable.** Always pass `AbortController.signal` to fetch calls inside the executor. The stop button needs to work immediately.

**SSE for real-time updates.** When the executor runs server-side (for scheduled workflows), use your existing SSE infrastructure to stream node status updates to the canvas. Client-side execution (for manual runs) can use callbacks directly.

**Config panel is a form builder, not a bunch of one-off components.** Build `ConfigField` once and drive it from `configSchema`. Adding a new node type should require zero UI work — just add an entry to `NODE_REGISTRY`.