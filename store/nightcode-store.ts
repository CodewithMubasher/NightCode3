import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Chat, Message, AttachmentData, Artifact, MessageStatus, ToolState, ToolStatus, AppSettings, AskData, Project, PendingConfirmation, GeneratedImage } from "@/types"
import { toast } from "sonner"

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function getChatTitle(content: string): string {
  const trimmed = content.trim()
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed
}

function emptyMessage(id: string, role: "user" | "assistant", status: MessageStatus, attachments?: AttachmentData[]): Message {
  return { id, role, content: "", toolStates: {}, artifacts: [], status, hasError: false, attachments }
}

function emptyAssistantMessage(id: string): Message {
  return { id, role: "assistant", content: "", reasoning: "", toolStates: {}, artifacts: [], status: "streaming", hasError: false }
}

interface NightCodeState {
  chats: Chat[]
  activeChatId: string | null
  projects: Project[]
  activeProjectId: string | null
  isStreaming: boolean
  askData: AskData | null
  pendingConfirmation: PendingConfirmation | null
  dismissConfirmation: () => void
  settings: AppSettings
  previewFilePath: string | null
  isPreviewOpen: boolean
  openPreview: (path: string) => void
  closePreview: () => void
  statusMessage: string | null
  setStatusMessage: (msg: string | null) => void

  createChat: (model?: string, provider?: string, projectId?: string) => string
  deleteChat: (id: string) => void
  setActiveChat: (id: string | null) => void

  createProject: (name: string, description: string) => Promise<string>
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => void
  toggleStarProject: (id: string) => void
  setActiveProject: (id: string | null) => void

  addMessage: (chatId: string, message: Message) => void
  updateMessageContent: (chatId: string, messageId: string, content: string) => void
  setMessageContent: (chatId: string, messageId: string, content: string) => void
  updateMessageReasoning: (chatId: string, messageId: string, text: string) => void
  setMessageReasoning: (chatId: string, messageId: string, text: string) => void
  updateToolState: (chatId: string, messageId: string, toolState: ToolState) => void
  updateMessageStatus: (chatId: string, messageId: string, status: MessageStatus) => void
  setMessageError: (chatId: string, messageId: string, error: boolean) => void
  upsertArtifact: (chatId: string, messageId: string, artifact: Artifact) => void
  deleteArtifact: (artifactId: string) => void
  renameChat: (id: string, title: string) => void
  moveChatToProject: (chatId: string, projectId: string | null) => void

  // Image generation
  addGeneratingImage: (chatId: string, messageId: string, image: GeneratedImage) => void
  resolveGeneratedImage: (chatId: string, messageId: string, imageId: string, url: string) => void
  failGeneratedImage: (chatId: string, messageId: string, imageId: string) => void

  rollbackToMessage: (chatId: string, messageId: string) => void

  sendMessage: (chatId: string, content: string, skills?: string[], attachments?: AttachmentData[], model?: string, provider?: string) => Promise<void>
  cancelStream: () => void
  setAskData: (data: AskData | null) => void
  setPendingConfirmation: (data: PendingConfirmation | null) => void
  confirmDeletion: (chatId: string) => Promise<void>
  cancelDeletion: (chatId: string) => void
  submitAskAnswers: (chatId: string, answers: Record<string, unknown>) => Promise<void>

  setSettings: (settings: Partial<AppSettings>) => void
  clearAll: () => void
}

let abortController: AbortController | null = null

export const useNightCodeStore = create<NightCodeState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeChatId: null,
      projects: [],
      activeProjectId: null,
      isStreaming: false,
      previewFilePath: null,
      isPreviewOpen: false,
      statusMessage: null,
      askData: null,
      pendingConfirmation: null,
      settings: {
        theme: "dark",
        primaryColor: "#D97757",
        defaultModel: "big-pickle",
        defaultProvider: "opencode",
        temperature: 0.7,
        maxTokens: 4096,
        soundEnabled: false,
        enterToSend: true,
        reducedMotion: false,
      },

      createChat: (model, provider, projectId) => {
        const id = generateId()
        const now = Date.now()
        const chat: Chat = {
          id,
          title: "New Chat",
          messages: [],
          model: model ?? "big-pickle",
          provider: provider ?? "opencode",
          createdAt: now,
          updatedAt: now,
          projectId,
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

      rollbackToMessage: (chatId, messageId) => {
        set((s) => {
          const chat = s.chats.find((c) => c.id === chatId)
          if (!chat) return s
          const idx = chat.messages.findIndex((m) => m.id === messageId)
          if (idx === -1) return s
          return {
            chats: s.chats.map((c) =>
              c.id === chatId
                ? { ...c, messages: c.messages.slice(0, idx + 1), updatedAt: Date.now() }
                : c
            ),
          }
        })
      },

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
                  messages: c.messages.map((m) => {
                    if (m.id === messageId) {
                      const sanitized = (m.content + content).replace(/<think>[\s\S]*?<\/think>/g, "")
                      return { ...m, content: sanitized }
                    }
                    return m
                  }),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },
      setMessageContent: (chatId, messageId, content) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id === messageId) {
                      const sanitized = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
                      return { ...m, content: sanitized }
                    }
                    return m
                  }),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },
      updateMessageReasoning: (chatId, messageId, text) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id === messageId) {
                      return { ...m, reasoning: (m.reasoning ?? "") + text }
                    }
                    return m
                  }),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },
      setMessageReasoning: (chatId, messageId, text) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id === messageId) {
                      return { ...m, reasoning: text }
                    }
                    return m
                  }),
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

      upsertArtifact: (chatId, messageId, artifact) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          artifacts: m.artifacts.some((a) => a.id === artifact.id)
                            ? m.artifacts.map((a) => (a.id === artifact.id ? artifact : a))
                            : [...m.artifacts, artifact],
                        }
                      : m
                  ),
                }
              : c
          ),
        }))
      },

      deleteArtifact: (artifactId) => {
        set((s) => ({
          chats: s.chats.map((c) => ({
            ...c,
            messages: c.messages.map((m) => ({
              ...m,
              artifacts: m.artifacts.filter((a) => a.id !== artifactId),
            })),
          })),
        }))
      },

      // ── Image generation state helpers ──────────────────────────────────
      addGeneratingImage: (chatId, messageId, image) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== messageId) return m
                    const imgs = m.generatedImages ?? []
                    // De-duplicate: if a generating card with the same prompt exists, update its id
                    const existingIdx = imgs.findIndex(
                      (img) => img.generating && img.prompt === image.prompt
                    )
                    if (existingIdx >= 0) {
                      const updated = [...imgs]
                      updated[existingIdx] = { ...updated[existingIdx], id: image.id }
                      return { ...m, generatedImages: updated }
                    }
                    return { ...m, generatedImages: [...imgs, image] }
                  }),
                }
              : c
          ),
        }))
      },

      resolveGeneratedImage: (chatId, messageId, imageId, url) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          generatedImages: (m.generatedImages ?? []).map((img) =>
                            img.id === imageId ? { ...img, url, generating: false } : img
                          ),
                        }
                      : m
                  ),
                }
              : c
          ),
        }))
      },

      failGeneratedImage: (chatId, messageId, imageId) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          generatedImages: (m.generatedImages ?? []).map((img) =>
                            img.id === imageId ? { ...img, generating: false, error: true, url: "" } : img
                          ),
                        }
                      : m
                  ),
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
      moveChatToProject: (chatId, projectId) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, projectId: projectId ?? undefined }
              : c
          ),
        }))
      },

      createProject: async (name, description) => {
        const id = generateId()
        const now = Date.now()
        const project: Project = { id, name, description, starred: false, createdAt: now, updatedAt: now }
        set((s) => ({ projects: [...s.projects, project], activeProjectId: id }))
        const chatId = generateId()
        const chatNow = Date.now()
        const chat: Chat = {
          id: chatId,
          title: name,
          messages: [],
          model: "big-pickle",
          provider: "opencode",
          createdAt: chatNow,
          updatedAt: chatNow,
          projectId: id,
        }
        set((s) => ({ chats: [...s.chats, chat], activeChatId: chatId }))
        try {
          await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, name, description }),
          })
        } catch {
          // workspace folder creation is best-effort
        }
        return chatId
      },

      renameProject: (id, name) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)),
        }))
      },

      deleteProject: (id) => {
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        }))
      },

      toggleStarProject: (id) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, starred: !p.starred, updatedAt: Date.now() } : p)),
        }))
      },

      setActiveProject: (id) => set({ activeProjectId: id }),

      cancelStream: () => {
        abortController?.abort()
        abortController = null
      },

      sendMessage: async (chatId, content, skills, attachments, model, provider) => {
        const state = get()
        if (state.isStreaming) return
        set({ isStreaming: true })
        const chat = get().chats.find((c) => c.id === chatId)
        if (!chat) { set({ isStreaming: false }); return }

        const prevModel = chat.model
        if (model && prevModel && model !== prevModel) {
          const sysMsg = {
            id: generateId(),
            role: "system" as const,
            content: `[System: Model switched from ${prevModel} to ${model}. Continue the conversation using the new model's capabilities and reasoning style. The previous analysis and context remain valid.]`,
            toolStates: {},
            artifacts: [],
            status: "complete" as const,
            hasError: false,
          }
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? { ...c, messages: [...c.messages, sysMsg] }
                : c
            ),
          }))
        }

        abortController = new AbortController()
        const signal = abortController.signal

        console.log('User message:', content)
        console.log('Skills:', skills)

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

        const userMessage = emptyMessage(generateId(), "user", "complete", attachments)
        userMessage.content = content

        const assistantMessage = emptyAssistantMessage(generateId())
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
        }))

        try {
          // ── Build multimodal message payload ──────────────────────────────
          // For messages with attachments, content becomes an array so the LLM
          // can see images and files — not just text.
          const messagePayload = [...chat.messages, userMessage].map((m) => {
            const textContent = m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()

            if (!m.attachments || m.attachments.length === 0) {
              return { role: m.role, content: textContent }
            }

            // Build multimodal content parts
            const parts: Array<{
              type: string
              text?: string
              image?: string
              mimeType?: string
              data?: string
              filename?: string
            }> = []

            if (textContent) {
              parts.push({ type: "text", text: textContent })
            }

            for (const att of m.attachments) {
              const mime = att.mediaType ?? att.contentType ?? ""
              const dataUrl = att.data ?? att.url ?? ""

              // Strip the "data:...;base64," prefix to get raw base64
              const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
              const base64Data = base64Match ? base64Match[1] : dataUrl

              if (mime.startsWith("image/")) {
                // Images go as image parts — Vercel AI SDK handles this for vision models
                parts.push({ type: "image", image: base64Data, mimeType: mime })
              } else if (mime === "application/pdf") {
                // PDFs as file parts
                parts.push({ type: "file", data: base64Data, mimeType: "application/pdf", filename: att.filename })
              } else {
                // Text files, CSVs, etc. — inline as text with filename header
                // Try to decode base64 back to text for text-based files
                try {
                  const decoded = typeof atob !== "undefined"
                    ? atob(base64Data)
                    : Buffer.from(base64Data, "base64").toString("utf-8")
                  parts.push({
                    type: "text",
                    text: `[Attached file: ${att.filename ?? "file"}]\n\`\`\`\n${decoded.slice(0, 20000)}\n\`\`\``,
                  })
                } catch {
                  parts.push({ type: "text", text: `[Attached file: ${att.filename ?? "file"} — could not decode content]` })
                }
              }
            }

            return { role: m.role, content: parts }
          })

          const effectiveProvider = provider ?? chat.provider
          const effectiveModel = model ?? chat.model

          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: messagePayload,
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
                  case "text_delta": {
                    const text = (parsed.payload?.text as string) ?? ""
                    if (text) {
                      // Direct DOM write via CustomEvent — avoids Zustand re-render per token.
                      if (typeof document !== "undefined") {
                        document.dispatchEvent(new CustomEvent("nc:token", {
                          detail: { messageId: assistantMessage.id, text },
                        }))
                      }
                      get().updateMessageContent(chatId, assistantMessage.id, text)
                    }
                    break
                  }
                  case "reasoning_delta": {
                    break
                  }
                  case "thinking": {
                    const text = (parsed.payload?.text as string) ?? ""
                    const reasoning = (parsed.payload?.reasoning as string) ?? ""
                    if (reasoning) get().setMessageReasoning(chatId, assistantMessage.id, reasoning)
                    if (text) {
                      const state = get()
                      const msg = state.chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === assistantMessage.id)
                      if (msg && !msg.content) {
                        get().setMessageContent(chatId, assistantMessage.id, text)
                      }
                    }
                    break
                  }
                  case "tool_start": {
                    const toolCallId = parsed.payload?.toolCallId as string
                    if (!toolCallId) break
                    const tool = (parsed.payload?.tool as string) ?? "unknown"
                    const args = (parsed.payload?.args as Record<string, unknown>) ?? {}
                    const ts: ToolState = {
                      id: toolCallId,
                      tool,
                      args,
                      status: "running",
                      timestamp: parsed.timestamp ?? Date.now(),
                    }
                    get().updateToolState(chatId, assistantMessage.id, ts)

                    // ── Image generation: add shimmer placeholder immediately ──
                    // addGeneratingImage is idempotent — retries reuse the same card
                    if (tool === "generate_image" && args.image_id) {
                      const placeholderImg: GeneratedImage = {
                        id: args.image_id as string,
                        url: "",
                        prompt: (args.prompt as string) ?? "",
                        aspectRatio: (args.aspect_ratio as string) ?? "1:1",
                        generating: true,
                      }
                      get().addGeneratingImage(chatId, assistantMessage.id, placeholderImg)
                    }

                    if (
                      tool === "write_file" &&
                      typeof args.path === "string" &&
                      args.path.endsWith(".html") &&
                      typeof window !== "undefined"
                    ) {
                      get().openPreview(args.path)
                    }
                    break
                  }
                  case "tool_end": {
                    const toolCallId = parsed.payload?.toolCallId as string
                    if (!toolCallId) break
                    const msg = get().chats.find((c) => c.id === chatId)
                      ?.messages.find((m) => m.id === assistantMessage.id)
                    // The engine emits tool_end with tc.toolCallId (LLM's ID),
                    // but tool_start registered under tc.generatedId (engine's ID).
                    // Check both to find the existing tool state.
                    let existing = msg?.toolStates[toolCallId]
                    if (!existing && msg) {
                      // Fallback: find by matching tool name from payload
                      const payloadTool = parsed.payload?.tool as string
                      if (payloadTool) {
                        for (const ts of Object.values(msg.toolStates)) {
                          if (ts.tool === payloadTool && ts.status === "running") {
                            existing = ts
                            break
                          }
                        }
                      }
                    }

                    // ── Image generation: resolve or fail the placeholder ──
                    const toolName = existing?.tool ?? (parsed.payload?.tool as string)
                    if (toolName === "generate_image") {
                      const result = parsed.payload?.result as Record<string, unknown> | undefined
                      const imageId = (existing?.args?.image_id ?? result?.image_id) as string | undefined
                      if (imageId) {
                        const payloadStatus = parsed.payload?.status as string
                        if (payloadStatus === "verified" && typeof result?.url === "string") {
                          get().resolveGeneratedImage(chatId, assistantMessage.id, imageId, result.url as string)
                        } else {
                          get().failGeneratedImage(chatId, assistantMessage.id, imageId)
                        }
                      }
                    }

                    if (existing) {
                      get().updateToolState(chatId, assistantMessage.id, {
                        id: existing.id,
                        tool: existing.tool,
                        args: existing.args,
                        status: (parsed.payload?.status as ToolStatus) ?? "verified",
                        result: parsed.payload?.result as Record<string, unknown> | undefined,
                        error: parsed.payload?.error as string | undefined,
                        discrepancy: parsed.payload?.discrepancy as string | undefined,
                        timestamp: existing.timestamp,
                      })
                    } else {
                      get().updateToolState(chatId, assistantMessage.id, {
                        id: toolCallId,
                        tool: (parsed.payload?.tool as string) ?? "unknown",
                        args: (parsed.payload?.args as Record<string, unknown>) ?? {},
                        status: (parsed.payload?.status as ToolStatus) ?? "verified",
                        result: parsed.payload?.result as Record<string, unknown> | undefined,
                        error: parsed.payload?.error as string | undefined,
                        discrepancy: parsed.payload?.discrepancy as string | undefined,
                        timestamp: parsed.timestamp ?? Date.now(),
                      })
                    }
                    break
                  }
                  case "artifact": {
                    const artifact = parsed.payload?.artifact as Artifact
                    if (artifact?.id) {
                      get().upsertArtifact(chatId, assistantMessage.id, artifact)
                    }
                    break
                  }
                  case "error": {
                    get().setMessageError(chatId, assistantMessage.id, true)
                    const errMsg = (parsed.payload?.message as string) ?? "An error occurred"
                    if (errMsg !== "An error occurred") toast.error(errMsg)
                    break
                  }
                  case "usage": {
                    const p = parsed.payload as Record<string, unknown> | undefined
                    if (p?.provider && p?.model) {
                      const { logUsage } = await import("@/lib/usage-tracker")
                      logUsage(
                        p.provider as string,
                        p.model as string,
                        (p.inputTokens as number) ?? 0,
                        (p.outputTokens as number) ?? 0,
                        (p.reasoningTokens as number) ?? 0,
                      )
                      // Update per-message tokens stats
                      const tps = (p.outputTokensPerSec as number) ?? 0
                      const totalTk = ((p.cumulativeInputTokens as number) ?? 0)
                        + ((p.cumulativeOutputTokens as number) ?? 0)
                        + ((p.cumulativeReasoningTokens as number) ?? 0)
                      if (tps > 0 || totalTk > 0) {
                        set((s) => ({
                          chats: s.chats.map((c) =>
                            c.id === chatId
                              ? {
                                  ...c,
                                  messages: c.messages.map((m) =>
                                    m.id === assistantMessage.id
                                      ? { ...m, tokensPerSec: tps, totalTokens: totalTk }
                                      : m
                                  ),
                                }
                              : c
                          ),
                        }))
                      }
                    }
                    break
                  }
                  case "ask": {
                    const payload = parsed.payload as Record<string, unknown> | undefined
                    if (payload?.questions) {
                      get().setAskData({ questions: payload.questions as AskData["questions"] })
                      get().updateMessageContent(chatId, assistantMessage.id, "Let me ask a few questions to tailor the response...")
                      get().updateMessageStatus(chatId, assistantMessage.id, "complete")
                    }
                    break
                  }
                  case "confirmation": {
                    const p = parsed.payload as Record<string, unknown> | undefined
                    if (p?.path && p?.fileCount != null && p?.toolCallId) {
                      get().setPendingConfirmation({
                        path: p.path as string,
                        fileCount: p.fileCount as number,
                        toolCallId: p.toolCallId as string,
                      })
                      get().updateMessageStatus(chatId, assistantMessage.id, "complete")
                    }
                    break
                  }
                  case "message_complete": {
                    get().updateMessageStatus(chatId, assistantMessage.id, "complete")
                    const completedMsg = get().chats.find((c) => c.id === chatId)
                      ?.messages.find((m) => m.id === assistantMessage.id)
                    const hasRunningTools = completedMsg?.toolStates
                      ? Object.values(completedMsg.toolStates).some((t) => t.status === "running")
                      : false
                    if (
                      completedMsg?.artifacts &&
                      completedMsg.artifacts.length > 0 &&
                      !hasRunningTools &&
                      typeof window !== "undefined"
                    ) {
                      window.dispatchEvent(new CustomEvent("toggle-artifact-panel"))
                    }
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
          // Clean up any shimmers that got stuck (engine crashed before tool_end)
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    ...(model && model !== c.model ? { model } : {}),
                    ...(provider && provider !== c.provider ? { provider } : {}),
                    messages: c.messages.map((m) => {
                      if (m.generatedImages?.some((img) => img.generating)) {
                        return {
                          ...m,
                          generatedImages: m.generatedImages.map((img) =>
                            img.generating ? { ...img, generating: false, error: true } : img
                          ),
                        }
                      }
                      return m
                    }),
                  }
                : c
            ),
            isStreaming: false,
          }))
          abortController = null
        }
      },

      setSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),
      setAskData: (data) => set({ askData: data }),
      setPendingConfirmation: (data) => set({ pendingConfirmation: data }),
      confirmDeletion: async (chatId) => {
        const state = get()
        if (!state.pendingConfirmation) return
        const { path, toolCallId } = state.pendingConfirmation
        const res = await fetch("/api/chat/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, messageId: state.chats.find((c) => c.id === chatId)?.messages.findLast((m) => m.role === "assistant")?.id, toolCallId, path }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Confirmation failed" }))
          toast.error(err.error ?? "Confirmation failed")
          set({ pendingConfirmation: null })
          return
        }
        const data = await res.json()
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    const existing = m.toolStates[toolCallId]
                    if (!existing) return m
                    return {
                      ...m,
                      toolStates: {
                        ...m.toolStates,
                        [toolCallId]: { ...existing, status: "verified" as ToolStatus, result: data.data },
                      },
                    }
                  }),
                }
              : c
          ),
          pendingConfirmation: null,
        }))
      },
      cancelDeletion: (chatId) => {
        const state = get()
        if (!state.pendingConfirmation) return
        const { toolCallId, path } = state.pendingConfirmation
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (!m.toolStates[toolCallId]) return m
                    const updated = { ...m.toolStates }
                    delete updated[toolCallId]
                    return { ...m, toolStates: updated }
                  }),
                }
              : c
          ),
          pendingConfirmation: null,
        }))
        toast.info(`Deletion of "${path}" cancelled`)
      },
      dismissConfirmation: () => {
        set({ pendingConfirmation: null })
      },
      submitAskAnswers: async (chatId, answers) => {
        const state = get()
        if (!state.askData) return
        const lines: string[] = []
        for (const q of state.askData.questions) {
          const val = answers[q.id]
          if (val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue
          const answerStr = Array.isArray(val) ? val.join(", ") : String(val)
          lines.push(`Q: ${q.question}\nA: ${answerStr}`)
        }
        set({ askData: null })
        if (lines.length === 0) return
        await get().sendMessage(chatId, lines.join("\n\n"))
      },
      clearAll: () => set({ chats: [], activeChatId: null }),
      openPreview: (path) => set({ previewFilePath: path, isPreviewOpen: true }),
      closePreview: () => set({ isPreviewOpen: false, previewFilePath: null }),
      setStatusMessage: (msg) => set({ statusMessage: msg }),
    }),
    {
      name: "nightcode-store",
      version: 1,
      partialize: (state) => ({
        chats: state.chats,
        activeChatId: state.activeChatId,
        projects: state.projects,
        settings: state.settings,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        for (const chat of state.chats) {
          for (const msg of chat.messages) {
            if (msg.status === "streaming") {
              const toolStates = msg.toolStates
              const hasRunning = Object.values(toolStates).some((t) => t.status === "running")
              if (hasRunning) {
                for (const [id, ts] of Object.entries(toolStates)) {
                  if (ts.status === "running") {
                    toolStates[id] = { ...ts, status: "skipped" }
                  }
                }
                msg.status = "interrupted"
              } else if (msg.hasError) {
                msg.status = "error"
              } else {
                msg.status = "complete"
              }
            }
            // Clean up any stuck generating images on reload
            if (msg.generatedImages) {
              msg.generatedImages = msg.generatedImages.map((img) =>
                img.generating ? { ...img, generating: false, error: true } : img
              )
            }
          }
        }
      },
    }
  )
)