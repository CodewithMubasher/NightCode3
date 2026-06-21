"use client"

import { useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, MessageSquare, ArrowLeft, Trash2, Pencil, MoreHorizontal, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PromptInput } from "@/components/prompt-input"
import { useNightCodeStore } from "@/store/nightcode-store"
import type { AttachmentData } from "@/types"

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const project = useNightCodeStore((s) => s.projects.find((p) => p.id === projectId) ?? null)
  const allChats = useNightCodeStore((s) => s.chats)
  const chats = useMemo(
    () => allChats.filter((c) => c.projectId === projectId),
    [allChats, projectId]
  )
  const isStreaming = useNightCodeStore((s) => s.isStreaming)

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Project not found</p>
        <Button variant="outline" size="sm" onClick={() => router.push("/projects")}>
          <ArrowLeft size={14} />
          Back to Projects
        </Button>
      </div>
    )
  }

  const p = project
  const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)

  function handleSubmit(content: string, _model: string, _attachments?: AttachmentData[], _provider?: string, _skills?: string[]) {
    const store = useNightCodeStore.getState()
    const existing = sortedChats[0]
    let chatId: string
    if (existing) {
      chatId = existing.id
      store.setActiveChat(chatId)
    } else {
      chatId = store.createChat(undefined, undefined, projectId)
    }
    router.push(`/chat/${chatId}`)
  }

  function handleRename() {
    const name = prompt("Rename project:", p.name)
    if (name?.trim()) useNightCodeStore.getState().renameProject(p.id, name.trim())
  }

  function handleDelete() {
    if (confirm("Delete this project? This will not delete the chats.")) {
      useNightCodeStore.getState().deleteProject(p.id)
      router.push("/projects")
    }
  }

  function handleNewChat() {
    const chatId = useNightCodeStore.getState().createChat(undefined, undefined, projectId)
    router.push(`/chat/${chatId}`)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/projects"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Back to projects"
              >
                <ArrowLeft size={16} />
              </Link>
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {p.name}
              </h1>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" onClick={handleNewChat} style={{ backgroundColor: "var(--primary-color)", color: "white" }}>
                <Plus size={14} />
                New Chat
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Project menu">
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onClick={handleRename}>
                    <Pencil size={14} />
                    <span>Rename</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} variant="destructive">
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {p.description && (
            <p className="-mt-2 text-sm text-muted-foreground">{p.description}</p>
          )}

          {sortedChats.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <MessageSquare size={24} className="text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No chats yet — type a message below to start one</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedChats.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/chat/${chat.id}`}
                  className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3 transition-colors duration-150 group hover:bg-sidebar-accent"
                >
                  <FileText className="size-4 shrink-0 text-sidebar-foreground/50" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-sidebar-foreground">
                      {chat.title}
                    </div>
                    <div className="text-xs text-sidebar-foreground/50">
                      {chat.messages.length > 1
                        ? `${chat.messages.filter((m) => m.role === "user").length} messages`
                        : "No messages yet"}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 bg-background px-6 pb-6 pt-2">
        <div className="mx-auto max-w-3xl">
          <PromptInput
            onSubmit={handleSubmit}
            disabled={isStreaming}
          />
        </div>
      </div>
    </div>
  )
}
