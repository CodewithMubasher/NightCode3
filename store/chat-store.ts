import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Chat, Message, PromptMode, AttachmentData, AIProvider, ToolCallEvent } from "@/types"
import { useTimelineStore } from "./timeline-store"
import { useArtifactStore } from "./artifact-store"

interface ChatStore {
  chats: Record<string, Chat>
  activeChatId: string | null
  streamingMessageId: string | null
  isThinking: boolean

  createChat: (mode: PromptMode, model: string, provider?: string) => string
  setActiveChat: (id: string | null) => void
  sendMessage: (chatId: string, content: string, attachments?: AttachmentData[], model?: string, provider?: string) => Promise<void>
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  updateChatSettings: (id: string, settings: { model?: string }) => void
  clearAll: () => void
}

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function getChatTitle(content: string): string {
  const trimmed = content.trim()
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      chats: {},
      activeChatId: null,
      streamingMessageId: null,
      isThinking: false,

      createChat: (mode, model, provider) => {
        const id = generateId()
        const now = Date.now()
        const chat: Chat = {
          id,
          title: "New Chat",
          messages: [],
          mode,
          model,
          provider: (provider || "opencode") as AIProvider,
          createdAt: now,
          updatedAt: now,
        }
        set((state) => ({ chats: { ...state.chats, [id]: chat }, activeChatId: id }))
        return id
      },

      setActiveChat: (id) => {
        useTimelineStore.getState().clearEvents()
        set({ activeChatId: id })
      },

      sendMessage: async (chatId, content, attachments, model, provider) => {
        const chat = get().chats[chatId]
        if (!chat) return

        const effectiveModel = model || chat.model

        const userMessage: Message = {
          id: generateId(),
          role: "user",
          content,
          timestamp: Date.now(),
          mode: chat.mode,
          attachments,
        }

        const assistantMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          mode: chat.mode,
          isStreaming: true,
        }

        const updatedTitle = chat.title === "New Chat" ? getChatTitle(content) : chat.title

        if (chat.mode === "plan") {
          useTimelineStore.getState().clearEvents()
        }

        set((state) => ({
          chats: {
            ...state.chats,
            [chatId]: {
              ...state.chats[chatId],
              title: updatedTitle,
              model: effectiveModel,
              messages: [...state.chats[chatId].messages, userMessage, assistantMessage],
              updatedAt: Date.now(),
            },
          },
          streamingMessageId: assistantMessage.id,
          isThinking: true,
        }))

        try {
          const messagePayload = [...chat.messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          }))

          const actualProvider = provider || chat.provider
          console.log("[STORE]", JSON.stringify({ model: effectiveModel, provider: actualProvider, mode: chat.mode }))

          if (!actualProvider) {
            throw new Error("Provider is missing in sendMessage")
          }

          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: messagePayload,
              model: effectiveModel,
              mode: chat.mode,
              provider: actualProvider,
            }),
          })

          if (!response.ok) throw new Error(`HTTP ${response.status}`)

          const reader = response.body?.getReader()
          if (!reader) throw new Error("No response body")

          const decoder = new TextDecoder()
          let buffer = ""
          let isDone = false

          while (!isDone) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || trimmed === "data: [DONE]") {
                if (trimmed === "data: [DONE]") isDone = true
                continue
              }
              if (!trimmed.startsWith("data: ")) continue

              try {
                const event = JSON.parse(trimmed.slice(6))

                if (event.type === "thinking_step") {
                  const text = (event.data?.text as string) || ""
                  set((state) => {
                    const c = state.chats[chatId]
                    if (!c) return state
                    return {
                      chats: {
                        ...state.chats,
                        [chatId]: {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantMessage.id
                              ? { ...m, content: m.content + text }
                              : m
                          ),
                        },
                      },
                    }
                  })

                } else if (event.type === "clear") {
                  set((state) => {
                    const c = state.chats[chatId]
                    if (!c) return state
                    return {
                      chats: {
                        ...state.chats,
                        [chatId]: {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantMessage.id ? { ...m, content: "" } : m
                          ),
                        },
                      },
                    }
                  })

                } else if (event.type === "timeline_activity") {
                  const ev = event.data as Record<string, unknown>
                  if (ev?.title) {
                    useTimelineStore.getState().addEvent({
                      id: ev.id as string,
                      type: (ev.type as "analysis" | "search" | "read" | "scan" | "generate" | "complete") || "analysis",
                      title: ev.title as string,
                      status: (ev.status as "pending" | "in_progress" | "completed") || "completed",
                      fileReference: ev.fileReference as { name: string; type: string } | undefined,
                      artifactId: ev.artifactId as string | undefined,
                      timestamp: (ev.timestamp as number) || Date.now(),
                    })
                  }

                } else if (event.type === "tool_call") {
                  // ── Upsert tool call into the assistant message in real-time ──
                  const ev = event.data as ToolCallEvent
                  set((state) => {
                    const c = state.chats[chatId]
                    if (!c) return state
                    const lastMsg = c.messages[c.messages.length - 1]
                    if (!lastMsg || lastMsg.role !== "assistant") return state
                    const existing = lastMsg.toolCalls ?? []
                    const existingIndex = existing.findIndex((e) => e.id === ev.id)
                    const updated =
                      existingIndex >= 0
                        ? existing.map((e) => (e.id === ev.id ? { ...e, ...ev } : e))
                        : [...existing, ev]
                    return {
                      chats: {
                        ...state.chats,
                        [chatId]: {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === lastMsg.id ? { ...m, toolCalls: updated } : m
                          ),
                        },
                      },
                    }
                  })

                } else if (event.type === "artifact_create") {
                  const art = event.data as Record<string, unknown>
                  if (art?.id && art?.title && art?.content) {
                    useArtifactStore.getState().addArtifact({
                      id: art.id as string,
                      title: art.title as string,
                      type: (art.type as "markdown" | "code" | "html" | "svg" | "mermaid") || "markdown",
                      content: art.content as string,
                    })
                  }

                } else if (event.type === "final") {
                  const finalData = event.data as Record<string, unknown>
                  const text = (finalData?.text as string) || ""
                  const tlEvents = useTimelineStore.getState().events

                  set((state) => {
                    const c = state.chats[chatId]
                    if (!c) return state

                    // Find the current assistant message to preserve toolCalls already in it
                    const currentMsg = c.messages.find((m) => m.id === assistantMessage.id)
                    const existingToolCalls = currentMsg?.toolCalls

                    return {
                      chats: {
                        ...state.chats,
                        [chatId]: {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantMessage.id
                              ? {
                                  ...m,
                                  // Only set content if there's text (don't wipe streaming content)
                                  ...(text ? { content: text } : {}),
                                  // Preserve tool calls that were built up during streaming
                                  ...(existingToolCalls?.length ? { toolCalls: existingToolCalls } : {}),
                                  // Embed timeline events for plan mode persistence
                                  ...(tlEvents.length > 0 ? { timelineEvents: tlEvents } : {}),
                                  isStreaming: false,
                                }
                              : m
                          ),
                        },
                      },
                    }
                  })
                  isDone = true

                } else if (event.type === "error") {
                  const errMsg = (event.data?.message as string) || "Unknown error"
                  set((state) => {
                    const c = state.chats[chatId]
                    if (!c) return state
                    return {
                      chats: {
                        ...state.chats,
                        [chatId]: {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantMessage.id
                              ? { ...m, content: errMsg, isStreaming: false }
                              : m
                          ),
                        },
                      },
                    }
                  })
                  isDone = true
                }
              } catch {
                // skip malformed JSON
              }
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Connection failed"
          set((state) => {
            const c = state.chats[chatId]
            if (!c) return state
            return {
              chats: {
                ...state.chats,
                [chatId]: {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, content: errMsg, isStreaming: false }
                      : m
                  ),
                },
              },
            }
          })
        } finally {
          set((state) => {
            const c = state.chats[chatId]
            if (!c) return state
            return {
              chats: {
                ...state.chats,
                [chatId]: {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMessage.id ? { ...m, isStreaming: false } : m
                  ),
                  updatedAt: Date.now(),
                },
              },
              streamingMessageId: null,
              isThinking: false,
            }
          })
        }
      },

      deleteChat: (id) => {
        set((state) => {
          const { [id]: _, ...rest } = state.chats
          return {
            chats: rest,
            activeChatId: state.activeChatId === id ? null : state.activeChatId,
          }
        })
      },

      renameChat: (id, title) => {
        set((state) => ({
          chats: {
            ...state.chats,
            [id]: { ...state.chats[id], title, updatedAt: Date.now() },
          },
        }))
      },

      updateChatSettings: (id, settings) => {
        set((state) => {
          const chat = state.chats[id]
          if (!chat) return state
          return {
            chats: {
              ...state.chats,
              [id]: {
                ...chat,
                ...(settings.model !== undefined ? { model: settings.model } : {}),
                updatedAt: Date.now(),
              },
            },
          }
        })
      },

      clearAll: () => set({ chats: {}, activeChatId: null, streamingMessageId: null }),
    }),
    {
      name: "nightcode-chats",
      version: 6,
      migrate: (persisted: unknown, version: number) => {
        const raw = persisted as Record<string, unknown>
        const state = (raw?.state as Record<string, unknown> | undefined) ?? raw
        const s = state as Record<string, unknown> | undefined
        if (version < 1) {
          if (s?.chats) {
            for (const chat of Object.values(s.chats) as Record<string, unknown>[]) {
              if (!chat.provider) chat.provider = "opencode"
            }
          }
        }
        if (s?.chats) {
          for (const chat of Object.values(s.chats) as Record<string, unknown>[]) {
            if (chat.provider === "backend") chat.provider = "opencode"
          }
        }
        return state as unknown as ChatStore
      },
    }
  )
)
