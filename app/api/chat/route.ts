import { NightCodeEngine } from "@/lib/engine"
import type { ToolImplementation } from "@/lib/engine/tools"
import type { AIProvider, Message } from "@/types"
import { createMCPToolImplementations } from "@/lib/mcp/tools-adapter"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, messageId, model, provider: rawProvider, skillInjected } = body

    console.log("API route received messages:", messages?.length ?? 0, "messages")
    messages?.forEach((m: any, i: number) => console.log(`  msg[${i}] role=${m.role} (${m.content?.length ?? 0} chars)`))
    console.log("API route skillInjected length:", skillInjected?.length ?? 0)

    if (!messages || !messageId) {
      return new Response("Missing required fields", { status: 400 })
    }

    const provider = (rawProvider || "opencode") as AIProvider
    const effectiveModel = model || "big-pickle"

    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const engine = new NightCodeEngine()

    req.signal.addEventListener("abort", () => {
      abortController.abort()
    })

    const stream = new ReadableStream({
      async start(controller) {
        const unsubscribe = engine.subscribe((_event, data: any) => {
          if (abortController.signal.aborted) return
          console.log('SSE event:', data.type, data.payload ? JSON.stringify(data.payload).substring(0, 100) : '')
          try {
            const line = `data: ${JSON.stringify(data)}\n\n`
            controller.enqueue(encoder.encode(line))
          } catch {
            // stream closed
          }
        })

        let mcpTools: ToolImplementation[] = []
        try {
          mcpTools = await createMCPToolImplementations()
        } catch {}
        console.log(`Loaded ${mcpTools.length} MCP tools`)

        const lastUserMsg = (messages as Message[]).filter(m => m.role === "user").pop()
        const imageMatch = lastUserMsg?.content?.match(/^\s*@image\s+(.+)/)
        if (imageMatch) {
          try {
            const prompt = imageMatch[1]
            const { default: puter } = await import("@heyputer/puter.js")
            const result = await puter.ai.txt2img(prompt, {
              test_mode: true,
              model: "gemini-2.5-flash",
              response_format: "b64_json",
            })
            const dataUrl = (result as any)?.data?.[0]?.b64_json
              ? `data:image/png;base64,${(result as any).data[0].b64_json}`
              : (result as any)?.image_url
              ? (result as any).image_url
              : null
            if (dataUrl) {
              const line = `data: ${JSON.stringify({ type: "image_generated", payload: { imageUrl: dataUrl, prompt }, timestamp: Date.now() })}\n\n`
              controller.enqueue(encoder.encode(line))
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", payload: { message: "No image from txt2img" }, timestamp: Date.now() })}\n\n`))
            }
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", payload: { message: err instanceof Error ? err.message : "Image gen failed" }, timestamp: Date.now() })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message_complete", payload: {}, timestamp: Date.now() })}\n\n`))
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
          return
        }

        try {
          await engine.run(
            messages as Message[],
            messageId,
            provider,
            effectiveModel,
            abortController.signal,
            body.skillInjected,
            mcpTools
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
