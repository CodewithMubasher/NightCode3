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

// A generated image stored on the message, rendered inline in chat
export interface GeneratedImage {
  id: string
  url: string
  prompt: string
  aspectRatio: string
  generating: boolean
  error?: boolean
}

export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  reasoning?: string
  toolStates: Record<string, ToolState>
  artifacts: Artifact[]
  status: MessageStatus
  hasError: boolean
  attachments?: AttachmentData[]
  generatedImages?: GeneratedImage[]
  tokensPerSec?: number
  totalTokens?: number
}

export interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  model: string
  provider: string
  updatedAt: number
  projectId?: string
}

export type AIProvider = "groq" | "openai" | "openrouter" | "google" | "opencode" | "ollama" | "xiaomi" | "cerebras" | "routeway" | "naga" | "sambanova" | "cloudflare" | "freetheai" | "nvidia" | "local"

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

export interface PendingConfirmation {
  path: string
  fileCount: number
  toolCallId: string
}

export interface AppSettings {
  theme: "dark" | "light" | "system"
  primaryColor: string
  defaultModel: string
  defaultProvider: string
  temperature: number
  maxTokens: number
  soundEnabled: boolean
  enterToSend: boolean
  reducedMotion: boolean
}

export interface Project {
  id: string
  name: string
  description: string
  starred: boolean
  createdAt: number
  updatedAt: number
}
