import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Chat, Message, PromptMode, AttachmentData, Artifact, MessageStatus, ToolState, ToolStatus, AppSettings } from "@/types"

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function getChatTitle(content: string): string {
  const trimmed = content.trim()
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed
}

function emptyMessage(id: string, role: "user" | "assistant", mode: PromptMode, status: MessageStatus, attachments?: AttachmentData[]): Message {
  return { id, role, content: "", mode, toolStates: {}, artifacts: [], status, hasError: false, attachments }
}

interface NightCodeState {
  chats: Chat[]
  activeChatId: string | null
  isStreaming: boolean
  settings: AppSettings

  createChat: (mode: PromptMode, model?: string, provider?: string) => string
  deleteChat: (id: string) => void
  setActiveChat: (id: string | null) => void

  addMessage: (chatId: string, message: Message) => void
  updateMessageContent: (chatId: string, messageId: string, content: string) => void
  updateToolState: (chatId: string, messageId: string, toolState: ToolState) => void
  updateMessageStatus: (chatId: string, messageId: string, status: MessageStatus) => void
  setMessageError: (chatId: string, messageId: string, error: boolean) => void
  addArtifact: (chatId: string, messageId: string, artifact: Artifact) => void
  deleteArtifact: (chatId: string, artifactId: string) => void
  renameChat: (id: string, title: string) => void

  sendMessage: (chatId: string, content: string, mode: PromptMode, skills?: string[], attachments?: AttachmentData[], model?: string, provider?: string) => Promise<void>
  cancelStream: () => void

  setSettings: (settings: Partial<AppSettings>) => void
  clearAll: () => void
}

let abortController: AbortController | null = null

export const useNightCodeStore = create<NightCodeState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeChatId: null,
      isStreaming: false,
      settings: {
        theme: "dark",
        primaryColor: "#FFFFFF",
      },

      createChat: (mode, model, provider) => {
        const id = generateId()
        const now = Date.now()
        const chat: Chat = {
          id,
          title: "New Chat",
          messages: [],
          mode,
          model: model ?? "big-pickle",
          provider: provider ?? "opencode",
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ chats: [...s.chats, chat], activeChatId: id }))
        return id
      },

      deleteChat: (id) => {
        set((s) => ({
          chats: s.chats.filter((c) => c.id !== id),
          activeChatId: s.activeChatId === id ? null : s.activeChatId,
        }))
      },

      setActiveChat: (id) => set({ activeChatId: id }),

      addMessage: (chatId, message) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() }
              : c
          ),
        }))
      },

      updateMessageContent: (chatId, messageId, content) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, content: m.content + content } : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },

      updateToolState: (chatId, messageId, toolState) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? { ...m, toolStates: { ...m.toolStates, [toolState.id]: toolState } }
                      : m
                  ),
                }
              : c
          ),
        }))
      },

      updateMessageStatus: (chatId, messageId, status) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, status } : m
                  ),
                }
              : c
          ),
        }))
      },

      setMessageError: (chatId, messageId, error) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, hasError: error } : m
                  ),
                }
              : c
          ),
        }))
      },

      addArtifact: (chatId, messageId, artifact) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, artifacts: [...m.artifacts, artifact] } : m
                  ),
                }
              : c
          ),
        }))
      },

      deleteArtifact: (chatId, artifactId) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => ({
                    ...m,
                    artifacts: m.artifacts.filter((a) => a.id !== artifactId),
                  })),
                }
              : c
          ),
        }))
      },

      renameChat: (id, title) => {
        set((s) => ({
          chats: s.chats.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)),
        }))
      },

      cancelStream: () => {
        abortController?.abort()
        abortController = null
      },

      sendMessage: async (chatId, content, mode, skills, attachments, model, provider) => {
        const state = get()
        const chat = state.chats.find((c) => c.id === chatId)
        if (!chat) return

        abortController?.abort()
        abortController = new AbortController()
        const signal = abortController.signal

        console.log('User message:', content)
        console.log('Skills detected:', skills)

        const skillStates: ToolState[] = []
        let skillInjected = ""
        if (skills && skills.length > 0) {
          for (const slug of skills) {
            try {
              const res = await fetch(`/api/skills/${slug}`)
              if (res.ok) {
                const data = await res.json() as { slug: string; title: string; content: string }
                skillInjected += `\n\n## ACTIVE SKILL: ${data.title}\n\nYou MUST follow the rules below in your response:\n${data.content}\n\nEND OF SKILL: ${data.title}`
                skillStates.push({
                  id: `skill_${slug}`,
                  tool: "skill",
                  args: { slug, title: data.title },
                  status: "verified" as ToolStatus,
                  timestamp: Date.now(),
                })
              }
            } catch {
              // skip failed skill load
            }
          }
        }

        const userMessage = emptyMessage(generateId(), "user", mode, "complete", attachments)
        userMessage.content = content

        const assistantMessage = emptyMessage(generateId(), "assistant", mode, "streaming")
        for (const ss of skillStates) {
          assistantMessage.toolStates[ss.id] = ss
        }

        const updatedTitle = chat.title === "New Chat" ? getChatTitle(content) : chat.title

        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  title: updatedTitle,
                  model: model ?? c.model,
                  provider: provider ?? c.provider,
                  messages: [...c.messages, userMessage, assistantMessage],
                  updatedAt: Date.now(),
                }
              : c
          ),
          isStreaming: true,
        }))

        try {
          const messagePayload = [...chat.messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          }))

          const effectiveProvider = provider ?? chat.provider
          const effectiveModel = model ?? chat.model

          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: messagePayload,
              mode,
              chatId,
              messageId: assistantMessage.id,
              model: effectiveModel,
              provider: effectiveProvider,
              skillInjected: skillInjected || undefined,
            }),
            signal,
          })

          if (!response.ok) throw new Error(`HTTP ${response.status}`)

          const reader = response.body?.getReader()
          if (!reader) throw new Error("No response body")

          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || trimmed === "data: [DONE]") continue
              if (!trimmed.startsWith("data: ")) continue

              const raw = trimmed.slice(6)
              try {
                const parsed = JSON.parse(raw) as {
                  type: string
                  payload?: Record<string, unknown>
                  timestamp?: number
                }

                switch (parsed.type) {
                  case "thinking": {
                    const text = (parsed.payload?.text as string) ?? ""
                    if (text) get().updateMessageContent(chatId, assistantMessage.id, text)
                    break
                  }
                  case "tool_start": {
                    const ts: ToolState = {
                      id: (parsed.payload?.tool as string) + "_" + (parsed.payload?.iteration ?? "0"),
                      tool: (parsed.payload?.tool as string) ?? "unknown",
                      args: (parsed.payload?.args as Record<string, unknown>) ?? {},
                      status: "running",
                      timestamp: parsed.timestamp ?? Date.now(),
                    }
                    get().updateToolState(chatId, assistantMessage.id, ts)
                    break
                  }
                  case "tool_end": {
                    const tool = (parsed.payload?.tool as string) ?? "unknown"
                    const stateId = tool + "_" + (parsed.payload?.iteration ?? "0")
                    const status = (parsed.payload?.status as ToolStatus) ?? "verified"
                    const existing = get().chats.find((c) => c.id === chatId)
                      ?.messages.find((m) => m.id === assistantMessage.id)
                      ?.toolStates[stateId]
                    if (existing) {
                      get().updateToolState(chatId, assistantMessage.id, {
                        ...existing,
                        status,
                        result: parsed.payload?.result as Record<string, unknown> | undefined,
                        error: parsed.payload?.error as string | undefined,
                        discrepancy: parsed.payload?.discrepancy as string | undefined,
                      })
                    }
                    break
                  }
                  case "artifact": {
                    const artifact = parsed.payload?.artifact as Artifact
                    if (artifact?.id) {
                      get().addArtifact(chatId, assistantMessage.id, artifact)
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("toggle-artifact-panel"))
                      }
                    }
                    break
                  }
                  case "error": {
                    get().setMessageError(chatId, assistantMessage.id, true)
                    break
                  }
                  case "message_complete": {
                    get().updateMessageStatus(chatId, assistantMessage.id, "complete")
                    break
                  }
                }
              } catch {
                // skip malformed JSON
              }
            }
          }

          const state = get()
          const currentMsg = state.chats.find((c) => c.id === chatId)
            ?.messages.find((m) => m.id === assistantMessage.id)
          if (currentMsg && currentMsg.status === "streaming") {
            console.log('Stream ended (HTTP 200). Final event received: message_complete? no. Setting status to complete.')
            get().updateMessageStatus(chatId, assistantMessage.id, "complete")
          }
        } catch (err) {
          if ((err as Error)?.name === "AbortError") {
            get().updateMessageStatus(chatId, assistantMessage.id, "interrupted")
          } else {
            get().setMessageError(chatId, assistantMessage.id, true)
            get().updateMessageStatus(chatId, assistantMessage.id, "error")
          }
        } finally {
          set({ isStreaming: false })
          abortController = null
        }
      },

      setSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),
      clearAll: () => set({ chats: [], activeChatId: null }),
    }),
    {
      name: "nightcode-store",
      version: 1,
      partialize: (state) => ({
        chats: state.chats,
        activeChatId: state.activeChatId,
        settings: state.settings,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        for (const chat of state.chats) {
          for (const msg of chat.messages) {
            if (msg.status === "streaming") {
              const hasRunning = Object.values(msg.toolStates).some((t) => t.status === "running")
              if (hasRunning) {
                msg.status = "interrupted"
              } else if (msg.hasError) {
                msg.status = "error"
              } else {
                msg.status = "complete"
              }
            }
          }
        }
      },
    }
  )
)
