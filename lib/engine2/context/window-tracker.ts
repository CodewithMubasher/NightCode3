import { TokenCounter } from "./token-counter"
import { PROVIDER_CONFIGS } from "../provider/types"
import type { ProviderConfig } from "../provider/types"

export interface WindowState {
  currentTokens: number
  reservedOutputTokens: number
  providerMaxContext: number
  availableTokens: number
  utilization: number
  isOverflowRisk: boolean
  systemPromptTokens: number
  toolTokens: number
  conversationTokens: number
  overheadTokens: number
}

export class WindowTracker {
  private counter: TokenCounter
  private providerCfg: ProviderConfig | undefined

  constructor(
    private readonly provider: string,
    private readonly model: string,
  ) {
    this.counter = new TokenCounter(model)
    this.providerCfg = PROVIDER_CONFIGS[provider]
  }

  get maxContext(): number {
    return this.providerCfg?.maxContext ?? 128_000
  }

  get reservedOutput(): number {
    return this.counter.estimateReservedOutput(this.model)
  }

  analyze(
    systemPrompt: string,
    messages: Array<{ role: string; content: unknown }>,
    tools?: Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  ): WindowState {
    const systemPromptTokens = this.counter.countSystemPrompt(systemPrompt)
    const toolTokens = tools ? this.counter.countToolDefinitions(tools) : 0
    const conversationTokens = this.counter.countMessages(messages)
    const overheadTokens = 20 // base request overhead
    const reservedOutput = this.reservedOutput

    const currentTokens = systemPromptTokens + toolTokens + conversationTokens + overheadTokens
    const availableTokens = this.maxContext - currentTokens - reservedOutput
    const utilization = currentTokens / this.maxContext

    return {
      currentTokens,
      reservedOutputTokens: reservedOutput,
      providerMaxContext: this.maxContext,
      availableTokens: Math.max(0, availableTokens),
      utilization,
      isOverflowRisk: currentTokens + reservedOutput > this.maxContext * 0.85,
      systemPromptTokens,
      toolTokens,
      conversationTokens,
      overheadTokens,
    }
  }

  /** Build human-readable context summary. */
  summarize(state: WindowState): string {
    const pct = (state.utilization * 100).toFixed(0)
    return [
      `Context: ${state.currentTokens.toLocaleString()} / ${this.maxContext.toLocaleString()} (${pct}%)`,
      `  System: ${state.systemPromptTokens.toLocaleString()}`,
      `  Tools: ${state.toolTokens.toLocaleString()}`,
      `  Conversation: ${state.conversationTokens.toLocaleString()}`,
      `  Reserved output: ${state.reservedOutputTokens.toLocaleString()}`,
      `  Available: ${state.availableTokens.toLocaleString()}`,
      state.isOverflowRisk ? "  ⚠️ Overflow risk — will compact" : "  ✅ Within limits",
    ].join("\n")
  }
}
