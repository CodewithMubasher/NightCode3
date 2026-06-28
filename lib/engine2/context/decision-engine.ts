import type { WindowState } from "./window-tracker"

export type ContextDecision =
  | { action: "continue" }
  | { action: "compact"; reason: string }
  | { action: "summarize"; reason: string; keepLast: number }
  | { action: "trim"; reason: string; keepLast: number }
  | { action: "stop"; reason: string }

export interface DecisionContext {
  windowState: WindowState
  stepCount: number
  maxSteps: number
  lastTextLength: number
  consecutiveToolFailures: number
  isFirstStep: boolean
  hasPendingToolCalls: boolean
}

export class DecisionEngine {
  decide(ctx: DecisionContext): ContextDecision {
    // Guard: max steps exceeded
    if (ctx.stepCount >= ctx.maxSteps) {
      return { action: "stop", reason: "Maximum steps exceeded" }
    }

    // Guard: too many consecutive tool failures
    if (ctx.consecutiveToolFailures >= 3) {
      return { action: "stop", reason: `${ctx.consecutiveToolFailures} consecutive tool failures` }
    }

    // Guard: overflow risk → compact
    if (ctx.windowState.isOverflowRisk) {
      if (ctx.stepCount <= 2) {
        return { action: "compact", reason: "Context overflow risk at step " + ctx.stepCount }
      }
      if (ctx.windowState.utilization > 0.9) {
        return { action: "summarize", reason: "Critical context pressure", keepLast: Math.max(2, ctx.stepCount - 3) }
      }
      return { action: "compact", reason: "Context approaching limit" }
    }

    // Guard: critical headroom depletion
    if (ctx.windowState.availableTokens < ctx.windowState.reservedOutputTokens * 0.5) {
      return { action: "summarize", reason: "Low headroom for output tokens", keepLast: Math.max(2, ctx.stepCount - 2) }
    }

    // Guard: empty text with no tools (possible loop)
    if (!ctx.isFirstStep && ctx.lastTextLength === 0 && !ctx.hasPendingToolCalls) {
      if (ctx.stepCount > 3) {
        return { action: "stop", reason: "Empty text with no tool calls for multiple steps" }
      }
    }

    return { action: "continue" }
  }
}
