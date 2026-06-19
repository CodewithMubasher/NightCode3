"use client"

import { useId } from "react"
import { usePathname } from "next/navigation"
import { Star, Asterisk, Astroid } from "lucide-react"

type Shape = "star" | "dot" | "astro" | "asterisk"

interface Celestial {
  x: number; y: number; size: number; shape: Shape
}

function c(x: number, y: number, size: number, shape: Shape): Celestial {
  return { x, y, size, shape }
}

const SCATTER: Celestial[] = [
  c(3, 5, 3, "dot"),
  c(8, 18, 10, "star"),
  c(14, 32, 4, "dot"),
  c(20, 48, 14, "asterisk"),
  c(25, 62, 3, "dot"),
  c(30, 75, 16, "astro"),
  c(34, 88, 2, "dot"),
  c(40, 10, 8, "star"),
  c(44, 25, 18, "asterisk"),
  c(48, 40, 2, "dot"),
  c(52, 55, 4, "dot"),
  c(56, 70, 10, "star"),
  c(60, 85, 3, "dot"),
  c(65, 7, 14, "astro"),
  c(68, 22, 2, "dot"),
  c(72, 38, 8, "star"),
  c(76, 52, 3, "dot"),
  c(80, 65, 12, "asterisk"),
  c(83, 80, 4, "dot"),
  c(87, 92, 10, "star"),
  c(90, 4, 3, "dot"),
  c(93, 28, 16, "astro"),
  c(96, 50, 2, "dot"),
  c(2, 60, 8, "star"),
  c(7, 72, 3, "dot"),
  c(12, 85, 12, "asterisk"),
  c(18, 95, 4, "dot"),
  c(23, 10, 14, "astro"),
  c(38, 82, 3, "dot"),
  c(46, 68, 10, "star"),
  c(64, 95, 2, "dot"),
  c(74, 92, 8, "asterisk"),
  c(92, 72, 3, "dot"),
  c(50, 5, 10, "star"),
  c(5, 48, 18, "astro"),
  c(22, 78, 4, "dot"),
  c(35, 15, 14, "asterisk"),
  c(50, 90, 3, "dot"),
  c(62, 35, 8, "star"),
  c(75, 75, 14, "astro"),
  c(85, 55, 3, "dot"),
  c(10, 92, 10, "star"),
  c(42, 60, 16, "asterisk"),
  c(95, 82, 2, "dot"),
  c(48, 20, 4, "dot"),
  c(16, 65, 14, "astro"),
  c(70, 48, 3, "dot"),
  c(90, 15, 8, "star"),
  c(32, 50, 12, "asterisk"),
  c(55, 12, 3, "dot"),
]

const TRAJECTORIES = [
  { right: 20, top: 10, dx: -75, dy: 50, delay: 0, duration: 6 },
  { right: 50, top: 5, dx: -80, dy: 55, delay: 4, duration: 7 },
  { right: 75, top: 15, dx: -85, dy: 60, delay: 9, duration: 5 },
  { right: 10, top: 25, dx: -70, dy: 45, delay: 14, duration: 8 },
  { right: 60, top: 30, dx: -78, dy: 52, delay: 20, duration: 6 },
]

function CelestialIcon({ shape, size }: { shape: Shape; size: number }) {
  switch (shape) {
    case "dot":
      return (
        <div
          className="rounded-full"
          style={{
            width: Math.max(size, 2),
            height: Math.max(size, 2),
            background: "rgba(255,245,220,0.5)",
          }}
        />
      )
    case "star":
      return <Star size={size} className="text-[rgba(255,245,220,0.5)]" strokeWidth={1.5} />
    case "astro":
      return <Astroid size={size} className="text-[rgba(255,245,220,0.4)]" strokeWidth={1.2} />
    case "asterisk":
      return <Asterisk size={size} className="text-[rgba(255,245,220,0.5)]" strokeWidth={1.5} />
  }
}

export function SpaceBackground() {
  const pathname = usePathname()
  const id = useId()

  if (pathname?.startsWith("/chat/")) return null

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,transparent_25%,black_65%)]">
      {SCATTER.map((s, i) => (
        <div
          key={`${id}-c-${i}`}
          className="absolute"
          style={{ left: `${s.x}%`, top: `${s.y}%` }}
        >
          <CelestialIcon shape={s.shape} size={s.size} />
        </div>
      ))}

      {TRAJECTORIES.map((s, i) => (
        <div
          key={`${id}-shoot-${i}`}
          className="shooting-star"
          style={{
            right: `${s.right}%`,
            top: `${s.top}%`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
            "--dx": `${s.dx}vw`,
            "--dy": `${s.dy}vh`,
          } as React.CSSProperties}
        >
          <div
            className="h-px"
            style={{
              width: 200,
              background: "linear-gradient(to left, transparent, rgba(255,250,240,0.8) 40%, rgba(255,255,255,0.95))",
              transform: "rotate(-25deg)",
              transformOrigin: "right center",
            }}
          />
          <div
            className="absolute -left-1 -top-[2px] h-[5px] w-[5px] rounded-full"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 0 6px 2px rgba(255,250,240,0.6)",
            }}
          />
        </div>
      ))}

      <style jsx>{`
        .shooting-star {
          position: absolute;
          opacity: 0;
          animation-name: fall;
          animation-timing-function: ease-out;
          animation-iteration-count: infinite;
        }

        @keyframes fall {
          0% { transform: translate(0, 0); opacity: 0; }
          4% { opacity: 1; }
          18% { opacity: 0.8; }
          30% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
