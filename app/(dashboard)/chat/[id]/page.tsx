"use client"

import { useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useVirtualizer } from "@tanstack/react-virtual"
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
  const messages = chat?.messages ?? []
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
  const autoScrollRef = useRef(true)
  const lastMessageCount = useRef(messages.length)

  useEffect(() => {
    if (!chat) router.replace("/")
  }, [chat, router])

  // Track scroll position to determine if user has scrolled up
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function onScroll() {
      if (!el) return
      const threshold = 100
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolled.current = dist > threshold
      autoScrollRef.current = dist <= threshold
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [id])

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: useCallback(() => scrollRef.current, []),
    estimateSize: useCallback(() => 120, []),
    overscan: 10,
  })

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > lastMessageCount.current) {
      lastMessageCount.current = messages.length
      if (autoScrollRef.current) {
        virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" })
      }
    }
  }, [messages.length, virtualizer])

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
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualizer.getVirtualItems()[0]?.start ?? 0}px)`,
            }}
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index]
                return (
                  <div
                    key={message.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
                  >
                    <MessageBubble message={message} />
                  </div>
                )
              })}
            </div>
          </div>
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
