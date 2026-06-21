"use client"

import * as React from "react"
import { X, ChevronLeft, ChevronRight, Pencil, ArrowRight } from "lucide-react"
import type { AskData } from "@/types"

interface QuestionsPanelProps {
  data: AskData
  onReject: () => void
  onSubmit: (answers: Record<string, string>) => void
}

export function QuestionsPanel({ data, onReject, onSubmit }: QuestionsPanelProps) {
  const [step, setStep] = React.useState(0)
  const [answers, setAnswers] = React.useState<Record<string, string>>({})
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null)
  const [customValue, setCustomValue] = React.useState("")
  const customInputRef = React.useRef<HTMLInputElement>(null)

  const questionCount = data.questions.length
  const current = data.questions[step]

  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onReject()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onReject])

  React.useEffect(() => {
    setCustomValue("")
  }, [step])

  function advance(newAnswers: Record<string, string>) {
    if (step < questionCount - 1) {
      setStep(step + 1)
    } else {
      onSubmit(newAnswers)
    }
  }

  function select(value: string) {
    const newAnswers = { ...answers, [current.id]: value }
    setAnswers(newAnswers)
    advance(newAnswers)
  }

  function submitCustom() {
    const val = customValue.trim()
    if (!val) return
    select(val)
  }

  function handleCustomKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      submitCustom()
    }
  }

  function goBack() {
    if (step > 0) setStep(step - 1)
  }

  function goForward() {
    if (step < questionCount - 1 && answers[current.id]) setStep(step + 1)
  }

  const canGoForward = step < questionCount - 1 && !!answers[current?.id]

  return (
    <div className="mx-auto w-full max-w-3xl">
        {/* ── Options Card ── */}
        <div
          style={{
            background: "#1c1c1c",
            border: "1px solid #2e2e2e",
            borderRadius: "16px",
            overflow: "hidden",
            marginBottom: "8px",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "18px 20px 16px",
            }}
          >
            {/* Question */}
            <span
              style={{
                fontSize: "15px",
                fontWeight: 500,
                color: "#e8e8e8",
                lineHeight: 1.4,
                fontFamily: "inherit",
              }}
            >
              {current?.question}
            </span>

            {/* Navigation + close */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "2px",
                flexShrink: 0,
                marginLeft: "16px",
              }}
            >
              <button
                onClick={goBack}
                disabled={step === 0}
                style={{
                  background: "none",
                  border: "none",
                  cursor: step > 0 ? "pointer" : "default",
                  padding: "4px",
                  color: step > 0 ? "#9ca3af" : "#4a4a4a",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ChevronLeft size={14} />
              </button>

              <span
                style={{
                  fontSize: "12px",
                  color: "#9ca3af",
                  minWidth: "36px",
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {step + 1} of {questionCount}
              </span>

              <button
                onClick={goForward}
                disabled={!canGoForward}
                style={{
                  background: "none",
                  border: "none",
                  cursor: canGoForward ? "pointer" : "default",
                  padding: "4px",
                  color: canGoForward ? "#9ca3af" : "#4a4a4a",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ChevronRight size={14} />
              </button>

              <div style={{ width: "1px", height: "14px", background: "#2e2e2e", margin: "0 6px" }} />

              <button
                onClick={onReject}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  color: "#9ca3af",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "#2a2a2a" }} />

          {/* Options list */}
          {current && (
            <div key={current.id}>
              {(current.options ?? []).map((opt, idx) => {
                const isSelected = answers[current.id] === opt.value
                const isHovered = hoveredIdx === idx

                return (
                  <React.Fragment key={opt.value}>
                    <button
                      onClick={() => select(opt.value)}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        padding: "14px 20px",
                        background: isSelected || isHovered ? "rgba(255,255,255,0.04)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                        transition: "background 0.1s ease",
                      }}
                    >
                      {/* Index badge */}
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          flexShrink: 0,
                          fontSize: "11px",
                          fontWeight: 500,
                          background: isSelected ? "#ffffff" : "rgba(255,255,255,0.1)",
                          color: isSelected ? "#1c1c1c" : "#9ca3af",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {idx + 1}
                      </span>

                      {/* Label */}
                      <span
                        style={{
                          flex: 1,
                          fontSize: "14px",
                          fontWeight: 400,
                          color: isSelected ? "#ffffff" : "#d1d1d1",
                          lineHeight: 1.4,
                        }}
                      >
                        {opt.label}
                      </span>

                      {/* Arrow — visible on hover or selected */}
                      <ArrowRight
                        size={14}
                        style={{
                          color: "#9ca3af",
                          flexShrink: 0,
                          opacity: isHovered || isSelected ? 1 : 0,
                          transition: "opacity 0.15s ease",
                        }}
                      />
                    </button>

                    {/* Row divider */}
                    <div style={{ height: "1px", background: "#252525" }} />
                  </React.Fragment>
                )
              })}

              {/* ── Custom answer row ── */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  padding: "14px 20px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: "rgba(255,255,255,0.06)",
                    color: "#9ca3af",
                  }}
                >
                  <Pencil size={11} />
                </span>

                <input
                  ref={customInputRef}
                  type="text"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  onKeyDown={handleCustomKey}
                  placeholder="Something else..."
                  style={{
                    flex: 1,
                    background: "none",
                    border: "none",
                    outline: "none",
                    color: "#ffffff",
                    fontSize: "14px",
                    fontFamily: "inherit",
                    caretColor: "#ffffff",
                    lineHeight: 1,
                  }}
                />

                <button
                  onClick={() => {
                    if (customValue.trim()) submitCustom()
                  }}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    color: "#d1d1d1",
                    fontSize: "12px",
                    fontWeight: 500,
                    padding: "4px 10px",
                    fontFamily: "inherit",
                    flexShrink: 0,
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
  )
}
