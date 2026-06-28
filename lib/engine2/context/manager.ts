import { WindowTracker, type WindowState } from "./window-tracker"
import { DecisionEngine, type ContextDecision, type DecisionContext } from "./decision-engine"

export interface ContextReport {
  windowState: WindowState
  decision: ContextDecision
  summary: string
}

export class ContextManager {
  private tracker: WindowTracker
  private engine = new DecisionEngine()

  constructor(
    provider: string,
    model: string,
  ) {
    this.tracker = new WindowTracker(provider, model)
  }

  evaluate(
    systemPrompt: string,
    messages: Array<{ role: string; content: unknown }>,
    tools: Array<{ name: string; description: string; schema: Record<string, unknown> }> | undefined,
    stepContext: Omit<DecisionContext, "windowState">,
  ): ContextReport {
    const windowState = this.tracker.analyze(systemPrompt, messages, tools)

    const decision = this.engine.decide({
      windowState,
      ...stepContext,
    })

    return {
      windowState,
      decision,
      summary: this.tracker.summarize(windowState),
    }
  }

  get maxContext(): number {
    return this.tracker.maxContext
  }

  get reservedOutput(): number {
    return this.tracker.reservedOutput
  }
}
