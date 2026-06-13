import { Annotation, StateGraph, START, END } from "@langchain/langgraph"
import { executeLLM } from "../execute-llm"
import type { AIProvider } from "@/types"
import type { TimelineActivityType } from "@/store/timeline-store"
import { detectArtifactType, generateId } from "./plan-helpers"

const MessagesAnnotation = Annotation<
  Array<{ role: string; content: string }>
>({
  value: (current, incoming) => incoming ?? current,
  default: () => [],
})

const SystemPromptAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "",
})

const ModelAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "deepseek-v4-flash-free",
})

const ProviderAnnotation = Annotation<AIProvider>({
  value: (current, incoming) => incoming ?? current,
})

const AnalysisAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "",
})

const DeliverablesAnnotation = Annotation<string[]>({
  value: (current, incoming) => incoming ?? current,
  default: () => [],
})

export type GeneratedArtifact = {
  id: string
  title: string
  type: "markdown" | "code" | "json"
  content: string
}

const ArtifactsAnnotation = Annotation<GeneratedArtifact[]>({
  value: (current, incoming) => incoming ?? current,
  default: () => [],
})

const ResponseAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "",
})

export const PlanState = Annotation.Root({
  messages: MessagesAnnotation,
  systemPrompt: SystemPromptAnnotation,
  model: ModelAnnotation,
  provider: ProviderAnnotation,
  analysis: AnalysisAnnotation,
  deliverables: DeliverablesAnnotation,
  artifacts: ArtifactsAnnotation,
  response: ResponseAnnotation,
})

function getOnChunk(
  config: unknown
): (chunk: string) => void {
  return (config as Record<string, Record<string, unknown>>)
    ?.configurable?.onChunk as (chunk: string) => void
}

function emit(
  onChunk: (chunk: string) => void,
  type: string,
  data: Record<string, unknown>
) {
  onChunk(JSON.stringify({ type, data }))
}

function emitActivity(
  onChunk: (chunk: string) => void,
  title: string,
  status: "pending" | "in_progress" | "completed",
  activityType: TimelineActivityType,
  fileReference?: { name: string; type: string },
  artifactId?: string,
  eventId?: string
): string {
  const id = eventId || generateId()
  emit(onChunk, "timeline_activity", {
    id,
    type: activityType,
    title,
    status,
    fileReference,
    artifactId,
    timestamp: Date.now(),
  })
  return id
}

export function createPlanGraph() {
  const graph = new StateGraph(PlanState)

  const withNodes = graph
    .addNode(
      "analyze_request",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)

        const llmText = await executeLLM({
          provider: state.provider,
          model: state.model,
          messages: [
            {
              role: "system",
              content: `${state.systemPrompt}\n\nAnalyze the user's request and produce a concise 1-paragraph understanding of what they need. Focus on the core deliverable. Output ONLY the analysis text, no extra commentary.`,
            },
            ...state.messages,
          ],
          onChunk: () => {},
        })

        emitActivity(
          onChunk,
          "Analyzing request...",
          "completed",
          "analysis"
        )

        return { analysis: llmText.trim() }
      }
    )
    .addNode(
      "identify_deliverables",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)

        const llmText = await executeLLM({
          provider: state.provider,
          model: state.model,
          messages: [
            {
              role: "system",
              content: `${state.systemPrompt}\n\nYou are a planning assistant. Return a JSON array of filenames to create.

STRICT RULES:
- Default: return EXACTLY 1 file unless the user explicitly asks for more
- If user says "one", "single", "just a": return exactly 1 filename
- If user asks for multiple explicitly: return that exact number, max 3
- Return RAW JSON ARRAY ONLY — no explanation, no markdown, no backticks
- Use specific descriptive filenames relevant to the request

Examples:
- "create a PRD" → ["PRD.md"]
- "write a landing page plan" → ["Landing-Page-Plan.md"]
- "give me 2 docs for the API" → ["API-Reference.md", "Data-Model.md"]
- "create a file with 5 steps" → ["Website-Creation-Guide.md"]

Analysis: ${state.analysis}`,
            },
            {
              role: "user",
              content: `Analysis of request: ${state.analysis}\n\nWhat artifacts should be created?`,
            },
          ],
          onChunk: () => {},
        })

        let deliverables: string[] = []
        try {
          const cleaned = llmText.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")
          deliverables = JSON.parse(cleaned)
          if (!Array.isArray(deliverables)) deliverables = ["Plan.md"]
        } catch {
          deliverables = ["Plan.md"]
        }

        if (deliverables.length === 0) deliverables = ["Plan.md"]

        // Hard cap: extract quantity from user message
        const userMessage = state.messages.findLast?.(m => m.role === "user")?.content ?? ""
        const quantityMatch = userMessage.match(/\b(one|1|single|just one|only one)\b/i)
        const MAX_DELIVERABLES = quantityMatch ? 1 : 3
        if (deliverables.length > MAX_DELIVERABLES) {
          deliverables = deliverables.slice(0, MAX_DELIVERABLES)
        }

        emitActivity(
          onChunk,
          `Planning ${deliverables.length} file${deliverables.length === 1 ? "" : "s"}...`,
          "completed",
          "search"
        )

        return { deliverables }
      }
    )
    .addNode(
      "generate_artifacts",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)
        const generated: GeneratedArtifact[] = []

        for (const name of state.deliverables) {
          const ext = name.split(".").pop() || ""
          const fileRef = { name, type: ext }
          const eventId = generateId()

          emitActivity(
            onChunk,
            `Generating ${name}`,
            "in_progress",
            "generate",
            fileRef,
            undefined,
            eventId
          )

          let content: string

          try {
            const docType = detectArtifactType(name)

            const systemPrompt = `You are a technical writer. Generate the complete content for "${name}" based on the user's request.

Rules:
- Output ONLY the document content, no meta commentary, no introductions.
- For Markdown (.md): use proper markdown formatting with headings, lists, code blocks, tables.
- For code files: output valid code with proper syntax.
- For JSON: output valid JSON.
- Be comprehensive and detailed. Include real examples, concrete specifications.
- Use the analysis context below to guide the content.

Document type: ${docType}
Filename: ${name}`

            const llmText = await executeLLM({
              provider: state.provider,
              model: state.model,
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: `Request analysis: ${state.analysis}\n\nGenerate the complete content for: ${name}`,
                },
              ],
              onChunk: () => {},
            })

            content = llmText.trim()
          } catch {
            content = `# ${name}\n\n*Content generation failed for this artifact.*`
          }

          const artifactId = generateId()
          const artifactType = detectArtifactType(name)

          generated.push({
            id: artifactId,
            title: name,
            type: artifactType,
            content,
          })

          emit(onChunk, "artifact_create", {
            id: artifactId,
            title: name,
            type: artifactType,
            content,
          })

          emitActivity(
            onChunk,
            `Generated ${name}`,
            "completed",
            "generate",
            fileRef,
            artifactId,
            eventId
          )
        }

        return { artifacts: generated }
      }
    )
    .addNode(
      "finalize",
      async (state: typeof PlanState.State, config: unknown) => {
        const onChunk = getOnChunk(config)
        const count = state.artifacts.length
        const names = state.artifacts.map((a) => a.title).join(", ")

        emitActivity(
          onChunk,
          "Plan complete",
          "completed",
          "complete"
        )

        const llmText = await executeLLM({
          provider: state.provider,
          model: state.model,
          messages: [
            {
              role: "system",
              content: `${state.systemPrompt}\n\nSummarize the outcome naturally in 1-2 conversational sentences.

The following artifacts were generated: ${names}

Write a warm, brief summary of what was accomplished. Don't list the files — just describe the result in a natural, helpful tone.`,
            },
            {
              role: "user",
              content: `Summarize the ${count} artifacts created for: ${state.analysis}`,
            },
          ],
          onChunk: () => {},
        })

        const summary = llmText.trim()

        emit(onChunk, "final", { text: summary })

        return { response: summary }
      }
    )

  const compiled = withNodes
    .addEdge(START, "analyze_request")
    .addEdge("analyze_request", "identify_deliverables")
    .addEdge("identify_deliverables", "generate_artifacts")
    .addEdge("generate_artifacts", "finalize")
    .addEdge("finalize", END)
    .compile()

  return compiled
}
