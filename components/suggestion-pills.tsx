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
    <>
      <style>{`
        @keyframes pill-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="hidden sm:flex items-center justify-center gap-2">
        {SUGGESTIONS.map(({ icon: Icon, label, prompt }, i) => (
          <button
            key={label}
            onClick={() => onSelect?.(prompt)}
            disabled={disabled}
            style={{
              animation: `pill-in 0.35s cubic-bezier(0.25, 0.1, 0.25, 1) ${i * 0.06}s both`,
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-sidebar/80 px-3.5 py-1.5 text-sm text-foreground/80 transition-colors hover:border-white/40 hover:bg-sidebar hover:text-foreground disabled:opacity-50"
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
    </>
  )
}
