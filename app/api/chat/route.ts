import { getGraph } from "@/lib/ai/graphs"
import { getDefaultModel } from "@/lib/ai/execute-llm"
import type { AIProvider } from "@/types"

function sse(event: string, data: unknown): string {
  return `data: ${JSON.stringify({ type: event, data })}\n\n`
}

export async function POST(req: Request) {
  try {
    const { messages, model: modelId, mode = "chat", provider: rawProvider } = await req.json()

    if (!rawProvider) {
      throw new Error("Provider is missing — routing broken")
    }
    const provider = rawProvider as string

    console.log("[API RECEIVED]", JSON.stringify({ provider, model: modelId, mode, messageCount: messages?.length }))

    if (!messages || messages.length === 0) {
      return new Response(sse("error", { message: "No messages provided" }) + "data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    }

    const graph = getGraph(mode)
    const encoder = new TextEncoder()
    const effectiveModel = modelId || getDefaultModel(provider)

    // System prompt per mode
    const systemPromptByMode: Record<string, string> = {
      chat:
        "You are NightCode, a friendly and helpful AI assistant. Be concise, warm, and direct. Keep responses natural and conversational.",
      plan:
        "You are NightCode in Plan Mode. You create structured planning documents, PRDs, architecture diagrams, and technical specs.",
      build:
        "You are NightCode in Build Mode. You have full access to the file system and shell. Execute tasks directly.",
    }

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sse("debug", { provider, model: effectiveModel })))

        let firstRealChunk = true
        let finalSent = false

        try {
          await graph.invoke(
            {
              messages,
              model: effectiveModel,
              provider: provider as AIProvider,
              systemPrompt: systemPromptByMode[mode] || systemPromptByMode.chat,
              response: "",
            },
            {
              configurable: {
                onChunk: (chunk: string) => {
                  try {
                    const parsed = JSON.parse(chunk)
                    if (parsed?.type) {
                      if (parsed.type === "final") {
                        finalSent = true
                      }
                      if (firstRealChunk) {
                        firstRealChunk = false
                        controller.enqueue(encoder.encode(sse("clear", {})))
                      }
                      // Forward all typed events (timeline_activity, tool_call, artifact_create, final)
                      controller.enqueue(encoder.encode(sse(parsed.type, parsed.data)))
                      return
                    }
                  } catch {}

                  // Plain text chunk (chat mode)
                  if (firstRealChunk) {
                    firstRealChunk = false
                    controller.enqueue(encoder.encode(sse("clear", {})))
                  }
                  controller.enqueue(encoder.encode(sse("thinking_step", { text: chunk })))
                },
              },
            }
          )

          if (!finalSent) {
            controller.enqueue(encoder.encode(sse("final", { text: "" })))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Stream error"
          controller.enqueue(encoder.encode(sse("error", { message: `[${provider}] ${msg}` })))
        } finally {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid request"
    return new Response(sse("error", { message: msg }) + "data: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
    })
  }
}
