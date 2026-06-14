"use client"

import { useRouter } from "next/navigation"
import { PromptInput } from "@/components/prompt-input"
import { useNightCodeStore } from "@/store/nightcode-store"
import type { PromptMode, AttachmentData } from "@/types"

export function WelcomeScreen() {
  const router = useRouter()
  const createChat = useNightCodeStore((s) => s.createChat)
  const sendMessage = useNightCodeStore((s) => s.sendMessage)

  function handleSubmit(content: string, mode: PromptMode, model: string, attachments?: AttachmentData[], provider?: string) {
    const id = createChat(mode, model, provider)
    router.push(`/chat/${id}`)
    sendMessage(id, content, mode, attachments, model, provider)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 -mt-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Hey, Mubasher. Ready to dive in?
        </h1>
      </div>
      <div className="w-full max-w-3xl px-4">
        <PromptInput onSubmit={handleSubmit} />
      </div>
    </div>
  )
}
