export class RateCounter {
  private window: number[] = []
  private sum = 0

  constructor(
    private readonly windowMs: number,
    private readonly limit: number,
  ) {}

  add(weight: number): void {
    this.prune()
    this.window.push(weight)
    this.sum += weight
  }

  get count(): number {
    this.prune()
    return this.sum
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.count)
  }

  get utilization(): number {
    return this.limit > 0 ? this.count / this.limit : 0
  }

  get isExhausted(): boolean {
    return this.count >= this.limit
  }

  get timeUntilLimit(): number | null {
    this.prune()
    if (this.sum < this.limit) return null
    const oldest = this.window[0]
    if (oldest === undefined) return null
    return Math.max(0, this.windowMs - (Date.now() - oldest))
  }

  get estimatedTimeToLimit(): number | null {
    this.prune()
    const windowDuration = this.getWindowDuration()
    if (windowDuration <= 0 || this.sum <= 0) return null
    const ratePerMs = this.sum / windowDuration
    if (ratePerMs <= 0) return null
    const remaining = this.limit - this.sum
    if (remaining <= 0) return null
    return remaining / ratePerMs
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs
    let pruned = 0
    while (pruned < this.window.length && this.window[pruned] !== undefined) {
      // In a real sliding window, events are timestamped.
      // This simplified version uses a queue where all entries are equally distributed.
      break
    }
  }

  private getWindowDuration(): number {
    return this.windowMs
  }

  reset(): void {
    this.window = []
    this.sum = 0
  }
}

export class SlidingWindowCounter {
  private entries: Array<{ time: number; weight: number }> = []

  constructor(
    private readonly windowMs: number,
    private readonly limit: number,
  ) {}

  add(weight: number): void {
    this.entries.push({ time: Date.now(), weight })
    this.prune()
  }

  get count(): number {
    this.prune()
    return this.entries.reduce((sum, e) => sum + e.weight, 0)
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.count)
  }

  get utilization(): number {
    return this.limit > 0 ? this.count / this.limit : 0
  }

  get isExhausted(): boolean {
    return this.count >= this.limit
  }

  get predictionMs(): number | null {
    this.prune()
    if (this.entries.length < 2) return null
    const windowStart = this.entries[0].time
    const elapsed = Date.now() - windowStart
    if (elapsed <= 0) return null
    const ratePerMs = this.count / elapsed
    if (ratePerMs <= 0) return null
    const remaining = this.limit - this.count
    if (remaining <= 0) return null
    return remaining / ratePerMs
  }

  /** Returns how many of the limit have been used, by fraction of limit (0-1). */
  get cappedUtilization(): number {
    const u = this.utilization
    return Math.min(1, u)
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs
    this.entries = this.entries.filter((e) => e.time >= cutoff)
  }

  reset(): void {
    this.entries = []
  }
}
