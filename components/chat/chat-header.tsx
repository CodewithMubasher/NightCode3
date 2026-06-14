"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MoreHorizontal, Pencil, Trash2, Download } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNightCodeStore } from "@/store/nightcode-store"

interface ChatHeaderProps {
  chatId: string
}

export function ChatHeader({ chatId }: ChatHeaderProps) {
  const router = useRouter()
  const chat = useNightCodeStore((s) => s.chats.find((c) => c.id === chatId))
  const deleteChat = useNightCodeStore((s) => s.deleteChat)
  const renameChat = useNightCodeStore((s) => s.renameChat)
  const [renaming, setRenaming] = useState(false)
  const [newTitle, setNewTitle] = useState(chat?.title ?? "")

  if (!chat) return null

  function handleDelete() {
    deleteChat(chatId)
    router.push("/")
  }

  function handleRename() {
    if (newTitle.trim()) {
      renameChat(chatId, newTitle.trim())
    }
    setRenaming(false)
  }

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-end border-b border-border/50 bg-background/80 px-4 backdrop-blur-sm">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil size={14} />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete}>
              <Trash2 size={14} />
              <span>Delete</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Download size={14} />
              <span>Export</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRenaming(false)}>
          <div className="w-80 rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-medium">Rename Chat</h3>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              className="w-full rounded-md border bg-muted px-3 py-1.5 text-sm outline-none ring-1 ring-border focus:ring-foreground/30"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setRenaming(false)}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background transition-colors hover:bg-foreground/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
