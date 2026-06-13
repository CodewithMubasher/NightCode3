import Groq from "groq-sdk"

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com",
})

export interface StreamGroqChatOptions {
  messages: Array<{ role: string; content: string }>
  model: string
  systemPrompt?: string
  onChunk: (chunk: string) => void
}

export async function streamGroqChat(options: StreamGroqChatOptions): Promise<string> {
  const { model, systemPrompt, onChunk } = options

  const messages = systemPrompt
    ? [{ role: "system" as const, content: systemPrompt }, ...options.messages.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }))]
    : options.messages.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }))

  console.log("[PROVIDER] groq")
  console.log("[MODEL]", model)
  console.log("[URL]", "https://api.groq.com/openai/v1/chat/completions")

  const stream = await groq.chat.completions.create({
    model,
    messages,
    stream: true,
    temperature: 0.7,
  })

  let fullText = ""
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || ""
    if (!text) continue
    fullText += text
    onChunk(text)
  }

  return fullText
}
