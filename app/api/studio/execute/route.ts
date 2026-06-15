import { NextRequest } from "next/server"
import { loadMCPConfigs } from "@/lib/mcp/storage"
import { connectMCP, disconnectAll } from "@/lib/mcp/manager"
import { createGroq } from "@ai-sdk/groq"
import { generateText } from "ai"

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

interface RawNode {
  id: string
  type: string
  data: {
    label: string
    config: Record<string, string>
  }
}

interface RawEdge {
  id: string
  source: string
  target: string
}

function topologicalSort(nodes: RawNode[], edges: RawEdge[]): RawNode[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  const sorted: RawNode[] = []
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = nodeMap.get(id)
    if (node) sorted.push(node)
    for (const neighbor of adj.get(id) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, deg)
      if (deg === 0) queue.push(neighbor)
    }
  }
  return sorted
}

function buildInputMap(nodes: RawNode[], edges: RawEdge[]): Map<string, string> {
  const inputMap = new Map<string, string>()
  const sourceOutput = new Map<string, string>()
  for (const node of nodes) {
    if (node.type === "output") continue
    const edge = edges.find((e) => e.source === node.id)
    if (edge) {
      const placeholder = `__INPUT_FROM_${node.id}__`
      sourceOutput.set(node.id, placeholder)
      inputMap.set(edge.target, placeholder)
    }
  }
  return inputMap
}

export async function POST(req: NextRequest) {
  try {
    const { nodes, edges } = (await req.json()) as { nodes: RawNode[]; edges: RawEdge[] }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: object) => {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"))
        }

        try {
          const gmailConfig = loadMCPConfigs().find((c) => c.name === "Gmail-mcp")
          if (!gmailConfig) throw new Error("Gmail MCP not configured")

          await connectMCP(gmailConfig)
          const { connections } = await import("@/lib/mcp/manager")
          const gmailConn = connections.get("Gmail-mcp")
          if (!gmailConn) throw new Error("Gmail MCP connection failed")

          const sorted = topologicalSort(nodes, edges)
          const outputs = new Map<string, string>()

          for (const node of sorted) {
            send({ type: "node-status", nodeId: node.id, status: "running" })

            try {
              if (node.type === "gmail") {
                const query = node.data.config.query || ""
                const maxResults = parseInt(node.data.config.maxResults || "1", 10)
                const result = await gmailConn.client.callTool({
                  name: "gmail_inbox",
                  arguments: { max_results: maxResults },
                })
                const content = (result.content ?? []) as any[]
                const text = content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("\n")
                outputs.set(node.id, text)
                const preview = text.length > 100 ? text.slice(0, 100) + "..." : text
                send({ type: "node-status", nodeId: node.id, status: "completed", output: preview, outputLabel: "Email content" })
              } else if (node.type === "summarize") {
                const incomingEdges = edges.filter((e) => e.target === node.id)
                let inputText = ""
                for (const edge of incomingEdges) {
                  inputText += outputs.get(edge.source) ?? ""
                }
                if (!inputText.trim()) throw new Error("No input received from upstream node")

                const prompt = node.data.config.prompt || "Summarize the key points"
                const result = await generateText({
                  model: groq.languageModel("llama-3.1-8b-instant"),
                  prompt: `${prompt}\n\n---\n${inputText}`,
                })
                const summary = result.text
                outputs.set(node.id, summary)
                const preview = summary.length > 120 ? summary.slice(0, 120) + "..." : summary
                send({ type: "node-status", nodeId: node.id, status: "completed", output: preview, outputLabel: "Summary" })
              } else if (node.type === "output") {
                const incomingEdges = edges.filter((e) => e.target === node.id)
                let finalOutput = ""
                for (const edge of incomingEdges) {
                  finalOutput += outputs.get(edge.source) ?? ""
                }
                const display = finalOutput || "No output received"
                outputs.set(node.id, display)
                send({ type: "node-status", nodeId: node.id, status: "completed", output: display, outputLabel: "Final Output" })
              } else {
                send({ type: "node-status", nodeId: node.id, status: "failed", error: `Unknown node type: ${node.type}` })
              }
            } catch (err) {
              send({ type: "node-status", nodeId: node.id, status: "failed", error: (err as Error).message })
            }
          }
        } catch (err) {
          send({ type: "node-status", nodeId: "error", status: "failed", error: (err as Error).message })
        } finally {
          await disconnectAll()
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (err) {
    return new Response((err as Error).message, { status: 500 })
  }
}
