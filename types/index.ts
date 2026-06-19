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
  role: "user" | "assistant" | "system"
  content: string
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
  model: string
  provider: string
  updatedAt: number
}

export type AIProvider = "groq" | "openai" | "openrouter" | "google" | "opencode" | "puter" | "ollama" | "xiaomi" | "cerebras" | "routeway" | "naga"

export type View = "chat" | "settings" | "projects"

export interface SkillInfo {
  slug: string
  title: string
  description?: string
}

export interface AskOption {
  label: string
  value: string
}

export interface AskQuestion {
  id: string
  question: string
  options: AskOption[]
}

export interface AskData {
  questions: AskQuestion[]
}

export interface AppSettings {
  theme: "dark" | "light"
  primaryColor: string
  defaultModel: string
  defaultProvider: string
  temperature: number
  maxTokens: number
  soundEnabled: boolean
  enterToSend: boolean
}
