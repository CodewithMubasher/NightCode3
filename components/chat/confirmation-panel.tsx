"use client"

import * as React from "react"
import { Trash2, X, AlertTriangle } from "lucide-react"
import type { PendingConfirmation } from "@/types"

interface ConfirmationPanelProps {
  data: PendingConfirmation
  onConfirm: () => void
  onCancel: () => void
  onDismiss: () => void
}

export function ConfirmationPanel({ data, onConfirm, onCancel, onDismiss }: ConfirmationPanelProps) {
  const [loading, setLoading] = React.useState(false)
  const onConfirmRef = React.useRef(onConfirm)
  const onDismissRef = React.useRef(onDismiss)
  onConfirmRef.current = onConfirm
  onDismissRef.current = onDismiss

  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismissRef.current()
      if (e.key === "Enter" && !loading) handleConfirm()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [loading])

  async function handleConfirm() {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  const label = data.fileCount > 1
    ? `Delete ${data.fileCount} items`
    : "Delete 1 item"

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        style={{
          background: "#1c1c1c",
          border: "1px solid #3a1a1a",
          borderRadius: "16px",
          overflow: "hidden",
          marginBottom: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "14px",
            padding: "18px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              flexShrink: 0,
              background: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              marginTop: "2px",
            }}
          >
            <AlertTriangle size={16} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: "#e8e8e8",
                marginBottom: "4px",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "#9ca3af",
                fontFamily: "'Cascadia Code', 'Fira Code', monospace",
                wordBreak: "break-all",
                marginBottom: "14px",
              }}
            >
              {data.path}
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleConfirm}
                disabled={loading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  background: loading ? "rgba(239, 68, 68, 0.3)" : "#ef4444",
                  border: "none",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: loading ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: loading ? 0.7 : 1,
                }}
              >
                <Trash2 size={14} />
                {loading ? "Deleting..." : "Delete"}
              </button>

              <button
                onClick={onCancel}
                disabled={loading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid #2e2e2e",
                  borderRadius: "8px",
                  color: "#d1d1d1",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: loading ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: loading ? 0.5 : 1,
                }}
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
