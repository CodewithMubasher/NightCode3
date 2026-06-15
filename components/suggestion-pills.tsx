import { Code, FilePen, GraduationCap, Mail, Palette } from "lucide-react"

const SUGGESTIONS = [
  { icon: Code, label: "Code", prompt: "Write code to" },
  { icon: FilePen, label: "Write", prompt: "Write a document about" },
  { icon: GraduationCap, label: "Learn", prompt: "Explain how" },
  { icon: Mail, label: "Mail", prompt: "Send an email to" },
  { icon: Palette, label: "Design", prompt: "Design a UI for" },
]

interface SuggestionPillsProps {
  onSelect?: (prompt: string) => void
  disabled?: boolean
}

export function SuggestionPills({ onSelect, disabled }: SuggestionPillsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
        <button
          key={label}
          onClick={() => onSelect?.(prompt)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-sidebar px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground disabled:opacity-50"
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  )
}
