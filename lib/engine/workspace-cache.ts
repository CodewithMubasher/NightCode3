export class WorkspaceCache {
  private content = new Map<string, { content: string; totalLines: number; stepRead: number }>()
  private dirty = new Set<string>()
  private stepCounter = 0

  nextStep(): void {
    this.stepCounter++
  }

  get(path: string): { content: string; totalLines: number; stepRead: number } | undefined {
    return this.content.get(path)
  }

  set(path: string, content: string, totalLines: number): void {
    this.content.set(path, { content, totalLines, stepRead: this.stepCounter })
    this.dirty.delete(path)
  }

  markDirty(path: string): void {
    this.dirty.add(path)
    this.content.delete(path)
  }

  isDirty(path: string): boolean {
    return this.dirty.has(path)
  }

  has(path: string): boolean {
    return this.content.has(path)
  }
}
