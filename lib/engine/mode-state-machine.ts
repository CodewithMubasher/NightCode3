import { Effect, Layer } from "effect"
import { Mode, canTransition, ModeTransitionError, Logger, SessionService, SessionState } from "./nightcode-effect"

export const MIN_PLAN_SUMMARY_LENGTH = 50

export interface ModeContext {
  currentMode: Mode
  previousMode: Mode | null
  planSummary: string | null
}

export function createInitialModeContext(mode: Mode): ModeContext {
  return { currentMode: mode, previousMode: null, planSummary: null }
}

export function transitionTo(
  ctx: ModeContext,
  target: Mode,
  sessionId?: string,
  planSummary?: string,
): Effect.Effect<ModeContext, ModeTransitionError> {
  return Effect.suspend(() => {
    if (!canTransition(ctx.currentMode, target)) {
      return Effect.fail(
        new ModeTransitionError(ctx.currentMode, target, `Cannot transition from ${ctx.currentMode} to ${target}`),
      )
    }
    const newCtx: ModeContext = {
      currentMode: target,
      previousMode: ctx.currentMode,
      planSummary: planSummary ?? ctx.planSummary,
    }
    return Effect.andThen(
      Logger.info(`Mode transition: ${ctx.currentMode} -> ${target}`),
      target === "build"
        ? Effect.andThen(
            Logger.info(`Transitioning to BUILD mode with plan: ${(planSummary ?? "").slice(0, 100)}...`),
            Effect.sync(() => newCtx),
          )
        : Effect.sync(() => newCtx),
    )
  })
}

export function verifyPlanGate(summary: string): Effect.Effect<void, ModeTransitionError> {
  return Effect.suspend(() => {
    if (!summary || summary.length < MIN_PLAN_SUMMARY_LENGTH) {
      return Effect.fail(
        new ModeTransitionError(
          "plan",
          "build",
          `Plan summary too short (${summary?.length ?? 0} chars, minimum ${MIN_PLAN_SUMMARY_LENGTH}). Continue investigating.`,
        ),
      )
    }
    const hasProjectKeywords = /(?:package|module|dependenc|architectur|structur|component|class|function|api|route|pattern|test|config|setup|build|deploy|schema|database|route|handler|middleware|store|reducer|hook|context|provider)/i.test(summary)
    if (!hasProjectKeywords) {
      return Effect.fail(
        new ModeTransitionError(
          "plan",
          "build",
          "Plan summary lacks project-specific keywords. Continue investigating to understand the codebase.",
        ),
      )
    }
    return Effect.unit
  })
}
