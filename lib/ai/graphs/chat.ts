import { Annotation, StateGraph, START, END } from "@langchain/langgraph"
import { executeLLM } from "../execute-llm"
import type { AIProvider } from "@/types"

const MessagesAnnotation = Annotation<Array<{ role: string; content: string }>>({
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

const ResponseAnnotation = Annotation<string>({
  value: (current, incoming) => incoming ?? current,
  default: () => "",
})

export const ChatState = Annotation.Root({
  messages: MessagesAnnotation,
  systemPrompt: SystemPromptAnnotation,
  model: ModelAnnotation,
  provider: ProviderAnnotation,
  response: ResponseAnnotation,
})

export function createChatGraph() {
  const graph = new StateGraph(ChatState)
    .addNode("chat", async (state, config) => {
      const onChunk = (config as any)?.configurable?.onChunk as ((chunk: string) => void) | undefined

      console.log("[GRAPH STATE]", JSON.stringify({ provider: state.provider, model: state.model }))

      if (!state.provider) {
        throw new Error("Provider is missing in graph state")
      }

      const fullText = await executeLLM({
        provider: state.provider,
        model: state.model,
        messages: state.messages,
        systemPrompt: state.systemPrompt,
        onChunk: (chunk: string) => {
          onChunk?.(chunk)
        },
      })

      return { response: fullText }
    })
    .addEdge(START, "chat")
    .addEdge("chat", END)
    .compile()

  return graph
}
