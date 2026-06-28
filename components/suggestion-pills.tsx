"use client"

import * as React from "react"
import { Code, FilePen, GraduationCap, Mail, Palette } from "lucide-react"
import type { SkillInfo } from "@/types"

const SUGGESTIONS = [
  { icon: Code, label: "Code", tag: "code" },
  { icon: FilePen, label: "Write", tag: "write" },
  { icon: GraduationCap, label: "Learn", tag: "learn" },
  { icon: Mail, label: "Mail", tag: "mail" },
  { icon: Palette, label: "Design", tag: "design" },
]

interface SuggestionPillsProps {
  onSelectSkill?: (slug: string) => void
  disabled?: boolean
}

export function SuggestionPills({ onSelectSkill, disabled }: SuggestionPillsProps) {
  const [skills, setSkills] = React.useState<SkillInfo[]>([])

  React.useEffect(() => {
    fetch("/api/skills").then((r) => r.json()).then((data: SkillInfo[]) => setSkills(data)).catch(() => {})
  }, [])

  function handlePillClick(tag: string) {
    const match = skills.find((s) => s.tags?.includes(tag))
    if (match) onSelectSkill?.(match.slug)
  }

  return (
    <>
      <style>{`
        @keyframes pill-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="hidden sm:flex items-center justify-center gap-2">
        {SUGGESTIONS.map(({ icon: Icon, label, tag }, i) => (
          <button
            key={label}
            onClick={() => handlePillClick(tag)}
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