const OPENCODE_BASE = process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1"
const OPENCODE_KEY = process.env.OPENCODE_API_KEY || ""

export interface StreamChatOptions {
  messages: Array<{ role: string; content: string }>
  model: string
  systemPrompt?: string
  onChunk: (chunk: string) => void
  signal?: AbortSignal
}

export async function streamChat(options: StreamChatOptions): Promise<string> {
  const { messages, model, systemPrompt, onChunk, signal } = options

  if (!OPENCODE_KEY) throw new Error("No API key configured for OpenCode")

  const apiMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages

  const response = await fetch(`${OPENCODE_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENCODE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`API error ${response.status}: ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let buffer = ""
  let fullText = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith("data: ")) continue

      const payload = trimmed.slice(6)
      if (payload === "[DONE]") continue

      try {
        const parsed = JSON.parse(payload)
        const delta = parsed.choices?.[0]?.delta
        const finishReason = parsed.choices?.[0]?.finish_reason

        if (delta?.content) {
          fullText += delta.content
          onChunk(delta.content)
        }

        if (finishReason === "stop") break
      } catch {
        // skip malformed chunks
      }
    }
  }

  return fullText
}
