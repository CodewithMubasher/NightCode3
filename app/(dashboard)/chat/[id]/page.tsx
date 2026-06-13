"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useChatStore } from "@/store/chat-store"
import { MessageBubble } from "@/components/chat/message-bubble"
import { PromptInput } from "@/components/prompt-input"
import type { PromptMode, AttachmentData } from "@/types"

export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const chat = useChatStore((s) => s.chats[id])
  const sendMessage = useChatStore((s) => s.sendMessage)
  const updateChatSettings = useChatStore((s) => s.updateChatSettings)
  const streamingMessageId = useChatStore((s) => s.streamingMessageId)
  const isThinking = useChatStore((s) => s.isThinking)

  useEffect(() => {
    if (!chat) router.replace("/")
  }, [chat, router])

  if (!chat) return null

  function handleSubmit(content: string, mode: PromptMode, model: string, attachments?: AttachmentData[], provider?: string) {
    console.log("[PAGE SUBMIT]", JSON.stringify({ provider, model, mode }))
    if (model && model !== chat.model) {
      updateChatSettings(id, { model })
    }
    sendMessage(id, content, attachments, model, provider)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto hide-scrollbar">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {chat.messages.map((message) => (
            <div
              key={message.id}
              className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
            >
              <MessageBubble message={message} chatId={id} />
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 bg-background px-4 pb-4 pt-2">
        <div className="mx-auto max-w-3xl">
          <PromptInput
            onSubmit={handleSubmit}
            disabled={streamingMessageId !== null || isThinking}
            defaultMode={chat.mode}
            defaultModel={chat.model}
            defaultProvider={chat.provider}
          />
        </div>
      </div>
    </div>
  )
}
