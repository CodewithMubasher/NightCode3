import { streamChat } from "./gateway"
import {
  getStepsBySession,
  getToolCallsBySession,
  getToolResultsBySession,
  getCompactionsBySession,
  createCompaction,
} from "@/lib/db/adapter"

export interface CompactionSummary {
  goal: string
  constraints: string
  inProgress: string
  done: string
  keyDecisions: string
  nextStep: string
  criticalContent: string
  relevantFiles: string
}

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export class CompactionService {
  private stepCountSinceLastCompaction = 0
  private readonly compactionInterval: number

  constructor(
    private sessionId: string,
    private config: {
      compactionInterval?: number
    } = {}
  ) {
    this.compactionInterval = config.compactionInterval ?? 10
  }

  async onStepComplete(
    stepNumber: number,
    provider: string,
    modelId: string
  ): Promise<{ stepRangeStart: number; stepRangeEnd: number } | null> {
    this.stepCountSinceLastCompaction++

    if (this.stepCountSinceLastCompaction < this.compactionInterval) return null

    const range = await this.compact(stepNumber, provider, modelId)
    this.stepCountSinceLastCompaction = 0
    return range
  }

  async onOverflow(
    stepNumber: number,
    provider: string,
    modelId: string
  ): Promise<{ stepRangeStart: number; stepRangeEnd: number } | null> {
    console.log(`[compaction] Context overflow detected at step ${stepNumber}, triggering on-demand compaction`)
    const range = await this.compact(stepNumber, provider, modelId)
    this.stepCountSinceLastCompaction = 0
    return range
  }

  private async compact(
    currentStepNumber: number,
    provider: string,
    modelId: string
  ): Promise<{ stepRangeStart: number; stepRangeEnd: number }> {
    const lastCompactions = getCompactionsBySession(this.sessionId)
    const lastCompactedStep = lastCompactions.length > 0
      ? lastCompactions[lastCompactions.length - 1].step_range_end
      : 0

    const steps = getStepsBySession(this.sessionId)
    const newSteps = steps.filter((s) => s.step_number > lastCompactedStep)
    if (newSteps.length === 0) return { stepRangeStart: lastCompactedStep + 1, stepRangeEnd: lastCompactedStep }

    const toolCalls = getToolCallsBySession(this.sessionId)
    const toolResults = getToolResultsBySession(this.sessionId)

    const stepData = newSteps.map((s) => ({
      step: s.step_number,
      finish_reason: s.finish_reason,
      tools: toolCalls
        .filter((tc) => tc.step_id === s.id)
        .map((tc) => {
          let args: unknown
          try { args = JSON.parse(tc.args) } catch { args = tc.args }
          const resultData = toolResults.find((tr) => tr.tool_call_id === tc.id)?.data
          let result: unknown = null
          if (resultData) {
            try { result = JSON.parse(resultData) } catch { result = resultData }
            const resultStr = typeof result === "string" ? result : JSON.stringify(result)
            if (resultStr.length > 2000) {
              result = resultStr.slice(0, 2000) + "\n... [truncated for compaction]"
            }
          }
          return {
            tool: tc.tool_name,
            args,
            status: tc.status,
            result,
          }
        }),
    }))

    const summary = await this.summarizeSteps(stepData, provider, modelId)

    const stepRangeStart = lastCompactedStep + 1
    const stepRangeEnd = currentStepNumber

    createCompaction({
      id: generateId(),
      session_id: this.sessionId,
      step_range_start: stepRangeStart,
      step_range_end: stepRangeEnd,
      summary: JSON.stringify(summary),
      created_at: Date.now(),
    })

    console.log(`[compaction] Compacted steps ${stepRangeStart}-${stepRangeEnd}`)
    return { stepRangeStart, stepRangeEnd }
  }

  private async summarizeSteps(
    stepData: unknown[],
    provider: string,
    modelId: string
  ): Promise<CompactionSummary> {
    const prompt = `You are a session compactor. Analyze the following agent execution steps and produce a concise structured summary.

Respond with ONLY valid JSON matching this schema (use "(none)" for empty fields):
{
  "goal": "What was the agent trying to achieve in these steps (one sentence)",
  "constraints": "Constraints, limitations, or preferences the agent was following",
  "inProgress": "What is currently in progress or partially done",
  "done": "What was completed in these steps",
  "keyDecisions": "Important architectural or design decisions made",
  "nextStep": "What the agent planned to do next",
  "criticalContent": "Critical information, code snippets, or context the agent must remember",
  "relevantFiles": "Paths to files that were created or modified"
}

Steps data:
${JSON.stringify(stepData, null, 2)}`

    try {
      const result = await streamChat(
        [
          { role: "system", content: "You are a session compactor. Output only valid JSON. No other text." },
          { role: "user", content: prompt },
        ],
        provider,
        modelId,
        undefined,
        undefined,
        {},
      )

      return JSON.parse(result.text) as CompactionSummary
    } catch {
      return {
        goal: "Agent execution steps",
        constraints: "(none)",
        inProgress: "(none)",
        done: `Completed ${stepData.length} steps`,
        keyDecisions: "(none)",
        nextStep: "(none)",
        criticalContent: "(none)",
        relevantFiles: "(none)",
      }
    }
  }
}
