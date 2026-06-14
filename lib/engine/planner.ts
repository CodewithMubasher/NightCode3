import { generateText, stepCountIs } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGroq } from "@ai-sdk/groq"
import type { AIProvider } from "@/types"

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
})

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

const opencode = createOpenAI({
  baseURL: "https://opencode.ai/zen/v1",
  apiKey: process.env.OPENCODE_API_KEY || "",
})

function getLanguageModel(provider: AIProvider, modelId: string) {
  switch (provider) {
    case "openai":
      return openai.languageModel(modelId)
    case "openrouter":
      return openrouter.chat(modelId)
    case "groq":
      return groq.languageModel(modelId)
    case "google": {
      const { createGoogleGenerativeAI } = require("@ai-sdk/google")
      const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
      return google.languageModel(modelId)
    }
    case "opencode":
      return opencode.chat(modelId)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

export type PlannerOutput =
  | { action: "tool_call"; tool: string; args: Record<string, unknown> }
  | { action: "respond"; content: string }

export async function plan(
  messages: Array<{ role: string; content: string }>,
  provider: AIProvider,
  modelId: string,
  signal?: AbortSignal
): Promise<PlannerOutput> {
  const model = getLanguageModel(provider, modelId)

  const result = await generateText({
    model,
    messages: messages as any,
    abortSignal: signal,
    temperature: 0.3,
    stopWhen: stepCountIs(10),
  })

  const text = result.text.trim()
  return parsePlannerOutput(text)
}

function parsePlannerOutput(text: string): PlannerOutput {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "").trim()

  const toolAliases: Record<string, string> = {
    createartifact: "create_artifact",
    create_artifact: "create_artifact",
    writefile: "write_file",
    write_file: "write_file",
    readfile: "read_file",
    read_file: "read_file",
    createfolder: "create_folder",
    create_folder: "create_folder",
    deletefile: "delete_file",
    delete_file: "delete_file",
    listdirectory: "list_directory",
    list_directory: "list_directory",
    searchfiles: "search_files",
    search_files: "search_files",
    executecommand: "execute_command",
    execute_command: "execute_command",
    think: "think",
  }

  let idx = 0
  while (idx < cleaned.length) {
    const jsonStart = cleaned.indexOf("{", idx)
    if (jsonStart === -1) break

    let depth = 0
    let jsonEnd = -1
    for (let i = jsonStart; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++
      else if (cleaned[i] === "}") {
        depth--
        if (depth === 0) { jsonEnd = i; break }
      }
    }
    if (jsonEnd === -1) break

    const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1)
    idx = jsonEnd + 1

    try {
      const parsed = JSON.parse(jsonStr)

      const action = (parsed.action || "").replace(/toolcall/i, "tool_call").replace(/_/g, "")

      const rawTool = parsed.tool?.toLowerCase()
      const tool = toolAliases[rawTool] || rawTool

      let args: Record<string, unknown> = parsed.args ?? {}
      if (tool === "create_artifact") {
        args = {
          title: (args.title as string) || (args.artifactname as string) || (args.artifact_name as string) || "Untitled",
          type: (args.type as string) || (args.artifacttype as string) || (args.artifact_type as string) || "markdown",
          content: (args.content as string) || (args.artifact_content as string) || "",
        }
      }

      if ((action === "toolcall" || action === "tool_call") && tool) {
        return { action: "tool_call", tool, args }
      }
      if (action === "respond" && typeof parsed.content === "string") {
        return { action: "respond", content: parsed.content }
      }
    } catch {
      // try next JSON object
    }
  }

  return { action: "respond", content: text }
}
