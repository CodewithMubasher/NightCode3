export type PromptMode = "plan" | "build" | "chat"

export interface AttachmentData {
  id: string
  type: "file" | "source-document"
  filename?: string
  mediaType?: string
  contentType?: string
  data?: string
  url?: string
  title?: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
  mode: PromptMode
  isStreaming?: boolean
  attachments?: AttachmentData[]
  timelineEvents?: TimelineEvent[]
  toolCalls?: ToolCallEvent[]
}

export interface Chat {
  id: string
  title: string
  messages: Message[]
  mode: PromptMode
  model: string
  provider: AIProvider
  createdAt: number
  updatedAt: number
}

export type AIProvider = "opencode" | "groq" | "openai" | "openrouter" | "google"

export type TimelineEvent = {
  id: string
  type: "analysis" | "search" | "read" | "scan" | "generate" | "complete"
  title: string
  status: "pending" | "in_progress" | "completed"
  fileReference?: { name: string; type: string }
  artifactId?: string
  timestamp: number
}

// New: tracks individual tool calls in Build mode
export type ToolCallEvent = {
  id: string
  tool: "read_file" | "write_file" | "list_directory" | "delete_file" | "execute_command" | "create_directory"
  args: Record<string, unknown>
  status: "running" | "done" | "error"
  result?: string
  timestamp: number
}

export type View = "chat" | "settings" | "projects"
