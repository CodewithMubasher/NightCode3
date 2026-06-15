import type { NodeStatus } from "./types"

export interface ExecutionEvent {
  type: "node-status"
  nodeId: string
  status: NodeStatus
  output?: string
  outputLabel?: string
  error?: string
}

type StatusCallback = (nodeId: string, status: NodeStatus, data?: { output?: string; outputLabel?: string; error?: string }) => void

export async function executeWorkflow(
  nodes: { id: string; type: string; data: Record<string, unknown> }[],
  edges: { id: string; source: string; target: string }[],
  onStatus: StatusCallback
): Promise<void> {
  const response = await fetch("/api/studio/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes, edges }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Execution failed: ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const raw = line.slice(6).trim()
      if (raw === "[DONE]") return

      try {
        const event: ExecutionEvent = JSON.parse(raw)
        if (event.type === "node-status") {
          onStatus(event.nodeId, event.status, {
            output: event.output,
            outputLabel: event.outputLabel,
            error: event.error,
          })
        }
      } catch {}
    }
  }
}
