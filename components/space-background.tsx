"use client"

import { useId, useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { Star } from "lucide-react"

const STAR_COLOR = "rgba(255,245,220,OPACITY)"

interface StarData {
  x: number; y: number; size: number; fadeIn: number; glowDelay: number; glowDuration: number
}

function star(x: number, y: number, size: number, fadeIn: number, glowDelay: number, glowDuration: number): StarData {
  return { x, y, size, fadeIn, glowDelay, glowDuration }
}

const SCATTER: StarData[] = [
  star(3, 5, 12, 0, 1.3, 3.2),
  star(8, 18, 9, 0.4, 4.7, 2.8),
  star(14, 32, 14, 0.1, 0.8, 4.1),
  star(20, 48, 10, 0.7, 6.2, 3.5),
  star(25, 62, 11, 0.2, 2.5, 2.6),
  star(30, 75, 8, 0.9, 8.1, 3.8),
  star(34, 88, 13, 0.3, 3.9, 2.9),
  star(40, 10, 10, 1.1, 5.4, 3.3),
  star(44, 25, 15, 0.5, 0.2, 4.5),
  star(48, 40, 9, 1.3, 7.6, 2.7),
  star(52, 55, 12, 0.6, 2.1, 3.6),
  star(56, 70, 8, 1.5, 9.3, 2.5),
  star(60, 85, 11, 0.8, 4.4, 3.9),
  star(65, 7, 10, 1.7, 1.9, 2.8),
  star(68, 22, 14, 0.15, 6.8, 4.2),
  star(72, 38, 9, 0.95, 3.1, 3.1),
  star(76, 52, 13, 0.25, 8.7, 2.9),
  star(80, 65, 8, 1.2, 0.6, 3.7),
  star(83, 80, 11, 0.45, 5.2, 4.0),
  star(87, 92, 10, 1.4, 2.8, 2.6),
  star(90, 4, 12, 0.55, 7.1, 3.4),
  star(93, 28, 9, 1.6, 4.0, 2.8),
  star(96, 50, 14, 0.05, 9.5, 3.8),
  star(2, 60, 8, 0.85, 1.5, 2.7),
  star(7, 72, 11, 0.65, 6.5, 4.3),
  star(12, 85, 10, 1.8, 3.4, 3.0),
  star(18, 95, 13, 0.35, 0.9, 3.5),
  star(23, 10, 9, 1.9, 8.4, 2.6),
  star(38, 82, 12, 0.75, 2.3, 4.4),
  star(46, 68, 8, 1.0, 7.8, 2.9),
  star(64, 95, 10, 0.5, 4.9, 3.6),
  star(74, 92, 11, 0.1, 1.1, 3.1),
  star(92, 72, 9, 0.2, 6.0, 2.7),
  star(50, 5, 10, 0.0, 3.6, 4.0),
  star(5, 48, 16, 0.3, 8.0, 3.3),
  star(22, 78, 14, 0.8, 2.0, 2.8),
  star(35, 15, 18, 0.1, 5.5, 4.6),
  star(50, 90, 15, 0.6, 0.4, 3.0),
  star(62, 35, 17, 1.1, 7.3, 3.7),
  star(75, 75, 14, 0.4, 4.2, 2.5),
  star(85, 55, 16, 0.9, 1.7, 4.2),
  star(10, 92, 13, 1.5, 6.3, 2.9),
  star(42, 60, 15, 0.2, 9.0, 3.4),
  star(95, 82, 14, 0.7, 3.0, 2.7),
  star(48, 20, 11, 0.5, 5.8, 4.1),
  star(16, 65, 13, 1.0, 2.7, 3.0),
  star(70, 48, 12, 0.05, 8.6, 3.6),
  star(90, 15, 14, 0.45, 4.5, 2.8),
  star(32, 50, 10, 0.95, 0.7, 3.9),
  star(55, 12, 8, 2.0, 6.7, 2.6),
]

export function SpaceBackground() {
  const pathname = usePathname()
  const id = useId()
  const [animations, setAnimations] = useState(true)
  const [shooting, setShooting] = useState(true)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "d") {
        e.preventDefault()
        setAnimations((p) => !p)
      }
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault()
        setShooting((p) => !p)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  if (pathname?.startsWith("/chat/")) return null

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,transparent_25%,black_65%)]">
      {SCATTER.map((s, i) => (
        <div
          key={`${id}-${i}`}
          className="absolute"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            opacity: 0,
            animation: `star-fade-in 2s ease-out forwards`,
            animationDelay: `${s.fadeIn}s`,
          }}
        >
          <Star
            size={s.size}
            className="drop-shadow-[0_0_6px_rgba(255,240,200,0.35)]"
            style={{
              color: STAR_COLOR.replace("OPACITY", "0.75"),
              animation: animations ? `star-pulse ${s.glowDuration}s ease-in-out infinite` : "none",
              animationDelay: animations ? `${s.glowDelay}s` : "0s",
            }}
          />
        </div>
      ))}

      {shooting && (
      <div
        className="absolute"
        style={{
          right: "8%",
          top: "6%",
          opacity: 0,
          animation: "shooting-star 8s ease-out infinite",
          animationDelay: "5s",
        }}
      >
        <div
          className="h-[2px]"
          style={{
            width: 220,
            background: "linear-gradient(to left, rgba(255,255,255,0), rgba(255,250,240,0.9))",
            transform: "rotate(-30deg)",
            transformOrigin: "right center",
          }}
        />
        <Star
          size={9}
          className="absolute -left-1 -top-[3px] fill-white drop-shadow-[0_0_8px_rgba(255,250,240,0.8)]"
          style={{ color: "#FFFFFF", opacity: 1 }}
        />
      </div>
      )}

      <style jsx>{`
        @keyframes star-fade-in {
          from { opacity: 0; transform: scale(0.5); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes star-pulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(0.35); }
        }
        @keyframes shooting-star {
          0% { transform: translate(0, 0); opacity: 0; }
          5% { opacity: 0.9; }
          20% { transform: translate(-72vw, 52vh); opacity: 0.7; }
          30% { transform: translate(-80vw, 70vh); opacity: 0; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
