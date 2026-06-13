"use client"

import * as React from "react"
import { type PromptMode } from "@/types"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Check, ChevronDown, ArrowUp, Square, Paperclip, Search } from "lucide-react"
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
  AttachmentRemove,
  type AttachmentData,
} from "@/components/ai-elements/attachments"

const MAX_INPUT = 1000

const modes: { value: PromptMode; label: string; color: string }[] = [
  { value: "plan", label: "Plan", color: "#FF8C00" },
  { value: "build", label: "Build", color: "#22C55E" },
  { value: "chat", label: "Chat", color: "#888" },
]

interface ModelEntry {
  id: string
  display_name: string
  provider: string
  provider_display_name: string
}

interface ModelGroup {
  label: string
  models: ModelEntry[]
}

interface PromptInputProps {
  onSubmit?: (content: string, mode: PromptMode, model: string, attachments?: AttachmentData[], provider?: string) => void
  disabled?: boolean
  defaultMode?: PromptMode
  defaultModel?: string
  defaultProvider?: string
}

const AVAILABLE_MODELS: ModelGroup[] = [
  {
    label: "OpenCode",
    models: [
      { id: "deepseek-v4-flash-free", display_name: "DeepSeek V4 Flash Free", provider: "opencode", provider_display_name: "OpenCode" },
    ],
  },
  {
    label: "Groq",
    models: [
      { id: "llama-3.1-8b-instant", display_name: "Llama 3.1 8B Instant", provider: "groq", provider_display_name: "Groq" },
      { id: "llama-3.1-70b-versatile", display_name: "Llama 3.1 70B Versatile", provider: "groq", provider_display_name: "Groq" },
      { id: "llama3-70b-8192", display_name: "Llama 3 70B", provider: "groq", provider_display_name: "Groq" },
      { id: "mixtral-8x7b-32768", display_name: "Mixtral 8x7B", provider: "groq", provider_display_name: "Groq" },
      { id: "gemma2-9b-it", display_name: "Gemma 2 9B", provider: "groq", provider_display_name: "Groq" },
    ],
  },
]

function findModelEntry(modelId: string, provider?: string): ModelEntry {
  for (const group of AVAILABLE_MODELS) {
    for (const m of group.models) {
      if (m.id === modelId && (!provider || m.provider === provider)) return m
      if (m.id === modelId) return m
    }
  }
  return AVAILABLE_MODELS[0].models[0]
}

const DEFAULT_ENTRY = AVAILABLE_MODELS[0].models[0]

export function PromptInput({ onSubmit, disabled, defaultMode, defaultModel, defaultProvider }: PromptInputProps) {
  const [mode, setMode] = React.useState<PromptMode>(defaultMode ?? "chat")
  const [selectedEntry, setSelectedEntry] = React.useState<ModelEntry>(() => {
    if (defaultModel) return findModelEntry(defaultModel, defaultProvider)
    return DEFAULT_ENTRY
  })
  const [value, setValue] = React.useState("")
  const [attachments, setAttachments] = React.useState<AttachmentData[]>([])
  const [modelSearch, setModelSearch] = React.useState("")
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const newAttachments: AttachmentData[] = await Promise.all(
      files.map(
        (file) =>
          new Promise<AttachmentData>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const data = reader.result as string
              resolve({
                id: crypto.randomUUID(),
                type: "file",
                filename: file.name,
                mediaType: file.type,
                url: data,
              })
            }
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
      )
    )
    setAttachments((prev) => [...prev, ...newAttachments])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const currentMode = modes.find((m) => m.value === mode)!
  const borderColor = currentMode.color

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    console.log("[UI]", JSON.stringify({ provider: selectedEntry.provider, model: selectedEntry.id }))
    console.log("[SUBMIT]", JSON.stringify({ provider: selectedEntry.provider, model: selectedEntry.id }))
    onSubmit?.(trimmed, mode, selectedEntry.id, attachments.length > 0 ? attachments : undefined, selectedEntry.provider)
    setValue("")
    setAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Tab" && e.target === textareaRef.current) {
      e.preventDefault()
      setMode((prev) => {
        const idx = modes.findIndex((m) => m.value === prev)
        return modes[(idx + 1) % modes.length].value
      })
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="w-full">
      {attachments.length > 0 && (
        <div className="mb-2">
          <Attachments variant="inline">
            {attachments.map((att) => (
              <Attachment key={att.id} data={att} onRemove={() => removeAttachment(att.id)}>
                <AttachmentPreview />
                <AttachmentInfo />
                <AttachmentRemove />
              </Attachment>
            ))}
          </Attachments>
        </div>
      )}
      <div
        className="relative flex flex-col rounded-xl border bg-sidebar p-4 pb-3 pt-2 shadow-sm"
        style={{ borderLeft: `2px solid ${borderColor}` }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            if (e.target.value.length <= MAX_INPUT) setValue(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="field-sizing-content max-h-48 min-h-[60px] w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50 hide-scrollbar"
          placeholder="How can I help you today?"
          rows={1}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Paperclip size={14} />
            </button>
            <span className="text-xs font-medium" style={{ color: borderColor }}>
              {currentMode.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <span className="max-w-28 truncate">{selectedEntry.id}</span>
                  <ChevronDown size={12} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-1" onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus() }}>
                <div className="relative mb-1">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={searchRef}
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search models..."
                    className="w-full rounded-md border border-input bg-transparent py-1.5 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
                  />
                </div>
                {(() => {
                  const filtered = AVAILABLE_MODELS
                    .map((g) => ({
                      ...g,
                      models: g.models.filter(
                        (m) =>
                          m.display_name.toLowerCase().includes(modelSearch.toLowerCase()) ||
                          m.id.toLowerCase().includes(modelSearch.toLowerCase()),
                      ),
                    }))
                    .filter((g) => g.models.length > 0)
                  return (
                    <div className="max-h-72 overflow-y-auto hide-scrollbar">
                      {filtered.length === 0 ? (
                        <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                          No models match
                        </div>
                      ) : (filtered.map((group) => (
                        <div key={group.label}>
                          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                            {group.label}
                          </div>
                          {group.models.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => { setSelectedEntry(model); setPopoverOpen(false); setModelSearch("") }}
                              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                            >
                              <span className="truncate">{model.display_name}</span>
                              {selectedEntry.id === model.id && (
                                <Check size={14} className="shrink-0 text-primary" />
                              )}
                            </button>
                          ))}
                        </div>
                      )))}
                    </div>
                  )
                })()}
              </PopoverContent>
            </Popover>

            {value.trim() && (
              <button
                onClick={disabled ? undefined : handleSubmit}
                disabled={disabled}
                className="flex size-7 items-center justify-center rounded-full bg-[#0099ff] text-white transition-all hover:bg-[#0099ff]/90 disabled:opacity-50"
              >
                {disabled ? <Square size={12} /> : <ArrowUp size={14} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
