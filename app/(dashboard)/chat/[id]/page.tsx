"use client"

import { useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { useNightCodeStore } from "@/store/nightcode-store"
import { MessageBubble } from "@/components/chat/message-bubble"
import { QuestionsPanel } from "@/components/chat/questions-panel"
import { ConfirmationPanel } from "@/components/chat/confirmation-panel"
import { PromptInput } from "@/components/prompt-input"
import type { AttachmentData } from "@/types"

export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const chat = useNightCodeStore((s) => s.chats.find((c) => c.id === id))
  const sendMessage = useNightCodeStore((s) => s.sendMessage)
  const isStreaming = useNightCodeStore((s) => s.isStreaming)
  const askData = useNightCodeStore((s) => s.askData)
  const pendingConfirmation = useNightCodeStore((s) => s.pendingConfirmation)
  const submitAskAnswers = useNightCodeStore((s) => s.submitAskAnswers)
  const confirmDeletion = useNightCodeStore((s) => s.confirmDeletion)
  const cancelDeletion = useNightCodeStore((s) => s.cancelDeletion)
  const dismissConfirmation = useNightCodeStore((s) => s.dismissConfirmation)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolled = useRef(false)

  useEffect(() => {
    if (!chat) router.replace("/")
  }, [chat, router])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function onScroll() {
      if (!el) return
      const threshold = 100
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolled.current = dist > threshold
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [id])

  useEffect(() => {
    if (userScrolled.current || !chat) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [chat?.messages.length, isStreaming])

  if (!chat) return null

  function handleSubmit(content: string, model: string, attachments?: AttachmentData[], provider?: string, skills?: string[]) {
    sendMessage(id, content, skills, attachments, model, provider)
  }

  function handleAskSubmit(answers: Record<string, unknown>) {
    submitAskAnswers(id, answers)
  }

  function handleAskReject() {
    submitAskAnswers(id, {})
  }

  function handleConfirmDeletion() {
    confirmDeletion(id)
  }

  function handleCancelDeletion() {
    cancelDeletion(id)
  }

  function handleDismissConfirmation() {
    dismissConfirmation()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto hide-scrollbar">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {chat.messages.map((message) => (
            <div
              key={message.id}
              className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
            >
              <MessageBubble message={message} />
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 bg-background px-4 pb-4 pt-2">
        {askData && (
          <QuestionsPanel
            data={askData}
            onSubmit={handleAskSubmit}
            onReject={handleAskReject}
          />
        )}
        {pendingConfirmation && (
          <ConfirmationPanel
            data={pendingConfirmation}
            onConfirm={handleConfirmDeletion}
            onCancel={handleCancelDeletion}
            onDismiss={handleDismissConfirmation}
          />
        )}
        <div className="mx-auto max-w-3xl">
          <PromptInput
            onSubmit={handleSubmit}
            disabled={isStreaming || !!askData || !!pendingConfirmation}
            defaultModel={chat.model}
            defaultProvider={chat.provider}
          />
        </div>
      </div>
    </div>
  )
}
