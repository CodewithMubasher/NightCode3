// Per-model token counting with estimated ratios.
// Uses model-specific chars-per-token ratios for accuracy.

const MODEL_ENCODINGS: Record<string, number> = {
  // GPT / OpenAI — ~4 chars/token
  "gpt-4": 4.0,
  "gpt-4o": 4.0,
  "gpt-5": 4.0,
  "o1": 4.0,
  "o3": 4.0,
  "o4": 4.0,

  // Claude — ~3.5 chars/token
  "claude": 3.5,
  "claude-sonnet": 3.5,
  "claude-haiku": 3.5,
  "claude-opus": 3.5,

  // Gemini — ~3 chars/token
  "gemini": 3.0,

  // Llama / local — ~5 chars/token
  "llama": 5.0,
  "deepseek": 5.0,
  "qwen": 5.0,

  // Default fallback
  "default": 4.0,
}

function findRatio(modelId: string): number {
  const lower = modelId.toLowerCase()
  for (const [pattern, ratio] of Object.entries(MODEL_ENCODINGS)) {
    if (lower.includes(pattern)) return ratio
  }
  return MODEL_ENCODINGS.default
}

export class TokenCounter {
  private ratio: number

  constructor(modelId: string) {
    this.ratio = findRatio(modelId)
  }

  count(text: string): number {
    if (!text) return 0
    return Math.ceil(text.length / this.ratio)
  }

  countMessages(messages: Array<{ role: string; content: unknown }>): number {
    let total = 0
    // Per-message overhead (role markers, formatting)
    const perMessageOverhead = 4 // ~4 tokens per message

    for (const msg of messages) {
      total += perMessageOverhead
      if (typeof msg.content === "string") {
        total += this.count(msg.content)
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          const p = part as Record<string, unknown>
          if (p.type === "text" && typeof p.text === "string") {
            total += this.count(p.text)
          } else if (p.type === "tool-call") {
            // Tool call overhead
            total += 10
            if (p.input) {
              total += this.count(JSON.stringify(p.input))
            }
          } else if (p.type === "tool-result") {
            total += 5
            if (p.output) {
              total += this.count(JSON.stringify(p.output))
            }
          }
        }
      }
    }

    return total
  }

  countToolDefinitions(
    tools: Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  ): number {
    if (!tools || tools.length === 0) return 0
    let total = 0
    for (const t of tools) {
      total += this.count(t.name)
      total += this.count(t.description)
      total += this.count(JSON.stringify(t.schema))
    }
    // Tool definition overhead
    total += tools.length * 5
    return total
  }

  countSystemPrompt(prompt: string): number {
    return this.count(prompt)
  }

  estimateReservedOutput(modelId: string): number {
    const lower = modelId.toLowerCase()
    // Conservative output token reservation (models typically allow 4K-16K output)
    if (lower.includes("claude")) return 8_192
    if (lower.includes("gemini")) return 8_192
    if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) return 16_384
    if (lower.includes("deepseek")) return 8_000
    return 4_096
  }
}
