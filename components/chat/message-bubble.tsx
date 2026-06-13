"use client"

import type { Message } from "@/types"
import { Copy, ThumbsUp, ThumbsDown, MoreHorizontal, Eclipse } from "lucide-react"
import {
  Attachments,
  Attachment,
  AttachmentPreview,
} from "@/components/ai-elements/attachments"
import { AgentTimeline } from "./agent-timeline"
import { BuildTimeline } from "./build-timeline"
import { renderInlineMarkdown } from "@/lib/render-markdown"

interface MessageBubbleProps {
  message: Message
  chatId?: string
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] space-y-2">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex justify-end">
              <Attachments variant="grid">
                {message.attachments.map((att) => (
                  <Attachment key={att.id} data={att as any}>
                    <AttachmentPreview />
                  </Attachment>
                ))}
              </Attachments>
            </div>
          )}
          <div className="rounded-2xl rounded-tr-sm bg-muted px-4 py-2.5 text-base text-foreground">
            <p className="leading-relaxed">{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 items-center justify-center pt-1.5">
          <Eclipse size={24} style={{ color: "#0099ff" }} className={message.isStreaming ? "animate-spin" : ""} />
        </div>
        <div className="min-w-0 flex-1 pt-1.5">
          {message.mode === "plan" ? (
            <>
              <AgentTimeline
                isStreaming={message.isStreaming}
                events={message.timelineEvents}
              />
              {message.content && (
                <div className="mt-1 text-base leading-relaxed" style={{ color: "#FFFFFF" }}>
                  {renderInlineMarkdown(message.content)}
                </div>
              )}
            </>
          ) : message.mode === "build" ? (
            <>
              <BuildTimeline
                isStreaming={message.isStreaming}
                events={message.toolCalls}
              />
              {message.content && (
                <div className="mt-1 text-base leading-relaxed" style={{ color: "#FFFFFF" }}>
                  {renderInlineMarkdown(message.content)}
                </div>
              )}
            </>
          ) : (
            <div className="text-base leading-relaxed">
              {message.isStreaming ? message.content : renderInlineMarkdown(message.content)}
            </div>
          )}
          {!message.isStreaming && message.content && (
            <div className="mt-2 flex items-center gap-0.5">
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Copy size={14} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <ThumbsUp size={14} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <ThumbsDown size={14} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <MoreHorizontal size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
