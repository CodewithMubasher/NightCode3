"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Eclipse } from "lucide-react"
import { PromptInput, type PromptInputHandle } from "@/components/prompt-input"
import { SuggestionPills } from "@/components/suggestion-pills"
import { useNightCodeStore } from "@/store/nightcode-store"
import { Shimmer } from "@/components/ai-elements/shimmer"
import type { AttachmentData } from "@/types"

export function WelcomeScreen() {
  const router = useRouter()
  const promptRef = useRef<PromptInputHandle>(null)
  const createChat = useNightCodeStore((s) => s.createChat)
  const sendMessage = useNightCodeStore((s) => s.sendMessage)
  const [shimmerDone, setShimmerDone] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShimmerDone(true), 2000)
    return () => clearTimeout(t)
  }, [])

  function handleSubmit(content: string, model: string, attachments?: AttachmentData[], provider?: string, skills?: string[]) {
    const id = createChat(model, provider)
    router.push(`/chat/${id}`)
    sendMessage(id, content, skills, attachments, model, provider)
  }

  return (
    <div className="flex h-full flex-col sm:items-center sm:justify-center sm:gap-6 sm:px-4 sm:-mt-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 sm:flex-initial sm:gap-0">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            <span className="sm:hidden inline-flex flex-col items-center gap-1">
              <span className="flex items-center gap-2">
                <Eclipse size={28} style={{ color: "var(--primary-color)" }} />
                <span>Hey Mubasher,</span>
              </span>
              <span className="text-foreground/70">Ready to dive in?</span>
            </span>
            <span className="hidden sm:inline">
              {shimmerDone ? (
                "Hey, Mubasher. Ready to dive in?"
              ) : (
                <Shimmer as="span" duration={1.2} spread={2}>
                  Hey, Mubasher. Ready to dive in?
                </Shimmer>
              )}
            </span>
          </h1>
        </div>
      </div>
      <div className="w-full px-4 pb-4 sm:pb-0 sm:px-0 sm:max-w-3xl">
        <PromptInput ref={promptRef} onSubmit={handleSubmit} />
      </div>
      <div className="hidden sm:flex w-full max-w-3xl flex-col items-center gap-4 px-4 pb-6">
        <SuggestionPills onSelectSkill={(slug) => promptRef.current?.setInputValue(`@${slug} `)} />
      </div>
    </div>
  )
}
