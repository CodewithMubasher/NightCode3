import { create } from "zustand"
import { persist } from "zustand/middleware"

export type TimelineActivityType =
  | "analysis"
  | "search"
  | "read"
  | "scan"
  | "generate"
  | "complete"

export type TimelineActivity = {
  id: string
  type: TimelineActivityType
  title: string
  status: "pending" | "in_progress" | "completed"
  fileReference?: { name: string; type: string }
  artifactId?: string
  timestamp: number
}

interface TimelineStore {
  events: TimelineActivity[]
  addEvent: (event: TimelineActivity) => string
  updateEventStatus: (
    id: string,
    status: TimelineActivity["status"]
  ) => void
  clearEvents: () => void
}

let counter = 0

export const useTimelineStore = create<TimelineStore>()(
  persist(
    (set, get) => ({
      events: [],

      addEvent: (event) => {
        const id = event.id || `tl_${Date.now()}_${counter++}`
        const existing = get().events.find((e) => e.id === id)
        if (existing) {
          set((state) => ({
            events: state.events.map((e) =>
              e.id === id ? { ...e, ...event, id } : e
            ),
          }))
        } else {
          const newEvent: TimelineActivity = {
            ...event,
            id,
            timestamp: event.timestamp || Date.now(),
          }
          set((state) => ({ events: [...state.events, newEvent] }))
        }
        return id
      },

      updateEventStatus: (id, status) =>
        set((state) => ({
          events: state.events.map((e) =>
            e.id === id ? { ...e, status } : e
          ),
        })),

      clearEvents: () => set({ events: [] }),
    }),
    {
      name: "nightcode-timeline",
      version: 1,
    }
  )
)
