"use client"

import * as React from "react"
import { type SkillInfo } from "@/types"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Check, ChevronDown, ArrowUp, Paperclip, Search, StopCircle, Scroll, Plus, Brain, Mic } from "lucide-react"
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
  AttachmentRemove,
  type AttachmentData,
} from "@/components/ai-elements/attachments"
import { useNightCodeStore } from "@/store/nightcode-store"
import { toast } from "sonner"

const MAX_INPUT = 1000

let cachedModelGroups: ModelGroupData[] | null = null
let cachedSkills: SkillInfo[] | null = null

const SpeechRecognitionAPI: (new () => object) | undefined = typeof window !== "undefined"
  ? ((window as unknown as Record<string, unknown>).SpeechRecognition as (new () => object) | undefined) ||
    ((window as unknown as Record<string, unknown>).webkitSpeechRecognition as (new () => object) | undefined)
  : undefined

interface ModelEntry {
  id: string
  display_name: string
  provider: string
  provider_display_name: string
}

interface PromptInputProps {
  onSubmit?: (content: string, model: string, attachments?: AttachmentData[], provider?: string, skills?: string[]) => void
  disabled?: boolean
  defaultModel?: string
  defaultProvider?: string
}

interface ModelGroupData {
  label: string
  models: ModelEntry[]
}

function findModelEntry(modelGroups: ModelGroupData[], modelId: string, provider?: string): ModelEntry | undefined {
  for (const group of modelGroups) {
    for (const m of group.models) {
      if (m.id === modelId && (!provider || m.provider === provider)) return m
      if (m.id === modelId) return m
    }
  }
  return modelGroups[0]?.models[0] ?? null
}

export function PromptInput({ onSubmit, disabled, defaultModel, defaultProvider }: PromptInputProps) {
  const settings = useNightCodeStore((s) => s.settings)
  const [modelGroups, setModelGroups] = React.useState<ModelGroupData[]>(cachedModelGroups ?? [])
  const [selectedEntry, setSelectedEntry] = React.useState<ModelEntry>({ id: defaultModel ?? settings.defaultModel, display_name: defaultModel ?? settings.defaultModel, provider: defaultProvider ?? settings.defaultProvider, provider_display_name: defaultProvider ?? settings.defaultProvider })
  const [value, setValue] = React.useState("")
  const [attachments, setAttachments] = React.useState<AttachmentData[]>([])
  const [modelSearch, setModelSearch] = React.useState("")
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [skills, setSkills] = React.useState<SkillInfo[]>(cachedSkills ?? [])
  const [skillSearch, setSkillSearch] = React.useState<string | null>(null)
  const [skillCursor, setSkillCursor] = React.useState(0)
  const [isListening, setIsListening] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const recognitionRef = React.useRef<{ abort: () => void; start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: unknown) => void) | null; onerror: (() => void) | null; onend: (() => void) | null } | null>(null)

  React.useEffect(() => {
    if (!cachedSkills) {
      fetch("/api/skills").then((r) => r.json()).then((data: SkillInfo[]) => { cachedSkills = data; setSkills(data) }).catch(() => {})
    }
    if (!cachedModelGroups) {
      fetch("/api/models").then((r) => r.json()).then((groups: ModelGroupData[]) => {
        cachedModelGroups = groups
        setModelGroups(groups)
      }).catch(() => {})
    }
  }, [])

  React.useEffect(() => {
    const groups = cachedModelGroups ?? modelGroups
    if (groups.length > 0) {
      const entry = findModelEntry(groups, defaultModel ?? settings.defaultModel, defaultProvider ?? settings.defaultProvider) ?? groups[0].models[0]
      setSelectedEntry(entry)
    }
  }, [defaultModel, defaultProvider, settings.defaultModel, settings.defaultProvider, modelGroups])

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

  function toggleListening() {
    if (!SpeechRecognitionAPI) {
      toast.error("Speech recognition is not supported in this browser")
      return
    }
    if (isListening) {
      recognitionRef.current?.abort()
      setIsListening(false)
      return
    }
    const Ctor = SpeechRecognitionAPI as new () => NonNullable<typeof recognitionRef.current>
    const recognition = new Ctor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = "en-US"
    recognition.onresult = (e: unknown) => {
      const results = (e as { results: { [index: number]: { [index: number]: { transcript: string } }; length: number } }).results
      const transcript = Array.from({ length: results.length }, (_, i) => results[i][0].transcript).join("")
      setValue((prev) => {
        const next = prev + " " + transcript
        return next.length > MAX_INPUT ? prev : next
      })
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  React.useEffect(() => {
    return () => recognitionRef.current?.abort()
  }, [])

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    const skillSlugs: string[] = []
    trimmed.replace(/@(\w[\w-]*)/g, (_m, slug) => {
      if (skills.some((s) => s.slug === slug)) skillSlugs.push(slug)
      return ""
    })
    onSubmit?.(trimmed, selectedEntry!.id, attachments.length > 0 ? attachments : undefined, selectedEntry!.provider, skillSlugs)
    setValue("")
    setAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  const filteredSkills = skillSearch !== null ? skills.filter((s) => s.slug.includes(skillSearch)) : []
  const showSkillSuggestions = skillSearch !== null && filteredSkills.length > 0

  function selectSkill(skill: SkillInfo) {
    const ta = textareaRef.current
    if (ta) {
      const before = value.slice(0, ta.selectionStart)
      const after = value.slice(ta.selectionStart)
      const atIdx = before.lastIndexOf("@")
      const newVal = before.slice(0, atIdx) + `@${skill.slug} ` + after
      setValue(newVal)
      React.startTransition(() => {
        const pos = before.slice(0, atIdx).length + skill.slug.length + 2
        ta.setSelectionRange(pos, pos)
        ta.focus()
      })
    }
    setSkillSearch(null)
    setSkillCursor(0)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showSkillSuggestions) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSkillCursor((p) => Math.min(p + 1, filteredSkills.length - 1)); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setSkillCursor((p) => Math.max(p - 1, 0)); return }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        selectSkill(filteredSkills[skillCursor])
        return
      }
      if (e.key === "Escape") { setSkillSearch(null); setSkillCursor(0); return }
    }
    if (e.key === "Enter" && !showSkillSuggestions) {
      if (settings.enterToSend && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
        return
      }
      if (!settings.enterToSend && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSubmit()
        return
      }
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
        className="relative flex flex-col rounded-xl border bg-sidebar/95 px-4 py-3 shadow-lg"
        style={{ borderLeft: "2px solid var(--primary-color)", borderRight: "2px solid var(--primary-color)" }}
      >
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              const newVal = e.target.value
              if (newVal.length > MAX_INPUT) return
              setValue(newVal)
              const ta = e.target
              const beforeCursor = newVal.slice(0, ta.selectionStart)
              const atIdx = beforeCursor.lastIndexOf("@")
              if (atIdx !== -1 && !beforeCursor.slice(atIdx).includes(" ")) {
                const query = beforeCursor.slice(atIdx + 1)
                setSkillSearch(query)
                setSkillCursor(0)
              } else {
                setSkillSearch(null)
              }
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="field-sizing-content max-h-48 min-h-[60px] w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50 hide-scrollbar"
            placeholder="How can I help you today? (type @ to add a skill)"
            rows={1}
          />
          {showSkillSuggestions && (
            <div className="absolute bottom-full left-0 max-w-80 mb-1 rounded-lg border border-white/10 bg-[#1a1a1a] p-1 shadow-xl">
              {filteredSkills.map((s, i) => (
                <button
                  key={s.slug}
                  onMouseDown={(e) => { e.preventDefault(); selectSkill(s) }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm ${i === skillCursor ? "bg-white/10" : ""}`}
                >
                  <Scroll size={14} style={{ color: "var(--primary-color)" }} />
                  <span className="text-foreground">{s.slug}</span>
                  <span className="ml-auto text-xs text-muted-foreground">@{s.slug}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  aria-label="Attach files"
                >
                  <Plus size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem
                  onSelect={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={14} className="mr-2" />
                  <span>Upload files</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const ta = textareaRef.current
                    if (ta) {
                      const before = value.slice(0, ta.selectionStart)
                      const after = value.slice(ta.selectionStart)
                      const newVal = before + "@deep " + after
                      setValue(newVal)
                      React.startTransition(() => {
                        const pos = before.length + 6
                        ta.setSelectionRange(pos, pos)
                        ta.focus()
                      })
                    }
                  }}
                >
                  <Brain size={14} className="mr-2" />
                  <span>Deep think</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-1">
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <span className="max-w-28 truncate">{selectedEntry!.id}</span>
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
                  const filtered = modelGroups
                    .map((g) => ({
                      ...g,
                      models: g.models.filter(
                        (m) =>
                          m.display_name.toLowerCase().includes(modelSearch.toLowerCase()) ||
                          m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
                          g.label.toLowerCase().includes(modelSearch.toLowerCase()),
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
                          {group.models.map((model, mi) => (
                            <button
                              key={`${group.label}-${model.id}-${mi}`}
                              onClick={() => { setSelectedEntry(model); setPopoverOpen(false); setModelSearch("") }}
                              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                            >
                              <span className="truncate">{model.display_name}</span>
                              {selectedEntry!.id === model.id && selectedEntry!.provider === model.provider && (
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

            <button
              onClick={toggleListening}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={isListening ? "Stop recording" : "Voice input"}
            >
              <Mic size={14} style={isListening ? { color: "#ef4444", filter: "drop-shadow(0 0 4px #ef4444)" } : undefined} />
            </button>
            {(value.trim() || disabled) && (
              <button
                onClick={disabled ? () => useNightCodeStore.getState().cancelStream() : handleSubmit}
                className="flex size-7 items-center justify-center rounded-full text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "var(--primary-color)" }}
                aria-label={disabled ? "Stop generation" : "Send message"}
              >
                {disabled ? <StopCircle size={14} /> : <ArrowUp size={14} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
