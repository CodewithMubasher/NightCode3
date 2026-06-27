import type { GatewayCallbacks, StreamResult, UsageInfo } from "./common"
import { formatOpenAIMessages, ApiError } from "./common"

export async function streamOllama(
  messages: Array<{ role: string; content: unknown }>,
  model: string,
  callbacks: GatewayCallbacks,
  headers: Record<string, string>,
  url: string,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: formatOpenAIMessages(messages),
      stream: true,
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new ApiError(res.status, `Ollama API error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response body")

  let collectedText = ""
  let usage: UsageInfo | undefined
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const json = JSON.parse(trimmed)
        if (json.done) {
          if (json.prompt_eval_count != null || json.eval_count != null) {
            usage = {
              inputTokens: json.prompt_eval_count ?? 0,
              outputTokens: json.eval_count ?? 0,
            }
          }
          break
        }
        const delta = json.message?.content || ""
        if (delta) {
          collectedText += delta
          callbacks.onText?.(delta)
        }
      } catch (e) { console.error("[ollama] Parse error:", e) }
    }
  }

  return { text: collectedText, reasoning: "", toolCalls: [], usage }
}
