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

export type AIProvider = "opencode" | "groq"

export type View = "chat" | "settings" | "projects"
