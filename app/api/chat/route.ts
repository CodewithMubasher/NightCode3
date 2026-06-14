import { NightCodeEngine } from "@/lib/engine"
import type { AIProvider, Message } from "@/types"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, mode, messageId, model, provider: rawProvider } = body

    if (!messages || !mode || !messageId) {
      return new Response("Missing required fields", { status: 400 })
    }

    const provider = (rawProvider || "opencode") as AIProvider
    const effectiveModel = model || "deepseek-v4-flash-free"

    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const engine = new NightCodeEngine()

    req.signal.addEventListener("abort", () => {
      abortController.abort()
    })

    const stream = new ReadableStream({
      async start(controller) {
        const unsubscribe = engine.subscribe((_event, data) => {
          if (abortController.signal.aborted) return
          try {
            const line = `data: ${JSON.stringify(data)}\n\n`
            controller.enqueue(encoder.encode(line))
          } catch {
            // stream closed
          }
        })

        try {
          await engine.run(
            messages as Message[],
            mode,
            messageId,
            provider,
            effectiveModel,
            abortController.signal
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Engine error"
          const line = `data: ${JSON.stringify({
            type: "error",
            payload: { message: msg },
            timestamp: Date.now(),
          })}\n\n`
          try { controller.enqueue(encoder.encode(line)) } catch {}
        } finally {
          unsubscribe()
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
    return new Response(
      `data: ${JSON.stringify({ type: "error", payload: { message: msg }, timestamp: Date.now() })}\n\ndata: [DONE]\n\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      }
    )
  }
}
