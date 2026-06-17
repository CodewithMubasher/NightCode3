export type EngineEventListener = (event: string, data: unknown) => void

interface DeadLetter {
  event: string
  data: unknown
  error: string
  timestamp: number
}

export class EventEmitter {
  private listeners: EngineEventListener[] = []
  private deadLetterQueue: DeadLetter[] = []

  subscribe(fn: EngineEventListener): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  emit(event: string, data: unknown): void {
    for (const fn of this.listeners) {
      try {
        fn(event, data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[event-emitter] Listener error for event "${event}": ${msg}`)
        this.deadLetterQueue.push({ event, data, error: msg, timestamp: Date.now() })
      }
    }
  }

  clear(): void {
    this.listeners = []
  }

  drainDeadLetters(): DeadLetter[] {
    const letters = [...this.deadLetterQueue]
    this.deadLetterQueue = []
    return letters
  }
}
