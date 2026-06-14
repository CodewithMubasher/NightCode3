export type EngineEventListener = (event: string, data: unknown) => void

export class EventEmitter {
  private listeners: EngineEventListener[] = []

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
      } catch {
        // swallow listener errors
      }
    }
  }

  clear(): void {
    this.listeners = []
  }
}
