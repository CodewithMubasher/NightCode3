import { getDb } from "./schema"

interface PendingOp {
  sql: string
  params: Record<string, unknown>
}

let queue: PendingOp[] = []
let batchingEnabled = false

export function enableBatching(): void {
  batchingEnabled = true
}

export function disableBatching(): void {
  batchingEnabled = false
}

export function queueWrite(sql: string, params: Record<string, unknown>): void {
  if (batchingEnabled) {
    queue.push({ sql, params })
  } else {
    getDb().prepare(sql).run(params)
  }
}

export function flushBatch(): void {
  if (queue.length === 0) return
  const ops = queue
  queue = []
  const db = getDb()
  db.transaction(() => {
    for (const op of ops) {
      db.prepare(op.sql).run(op.params)
    }
  })()
}
