export type PromptMode = "chat" | "plan" | "build"

export type MessageStatus = "streaming" | "complete" | "error" | "interrupted"

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

export type ToolStatus = "running" | "verified" | "verification_failed" | "error" | "skipped"

export interface ToolState {
  id: string
  tool: string
  args: Record<string, unknown>
  status: ToolStatus
  result?: Record<string, unknown>
  error?: string
  discrepancy?: string
  timestamp: number
}

export interface Artifact {
  id: string
  title: string
  type: "markdown" | "code" | "html" | "svg" | "mermaid"
  content: string
  language?: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  mode: PromptMode
  toolStates: Record<string, ToolState>
  artifacts: Artifact[]
  status: MessageStatus
  hasError: boolean
  attachments?: AttachmentData[]
}

export interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  mode: PromptMode
  model: string
  provider: string
  updatedAt: number
}

export type AIProvider = "opencode" | "groq" | "openai" | "openrouter" | "google"

export type View = "chat" | "settings" | "projects"
