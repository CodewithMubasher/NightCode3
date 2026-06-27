import type { Artifact } from "@/types"
import { listDBArtifacts, createDBArtifact, updateDBArtifact, deleteDBArtifact } from "@/lib/db/adapter"

const artifacts = new Map<string, Artifact>()
const MAX_ARTIFACTS = 200
let loaded = false

function loadFromDB(): void {
  if (loaded) return
  loaded = true
  try {
    const rows = listDBArtifacts()
    for (const row of rows) {
      artifacts.set(row.id, {
        id: row.id,
        title: row.title,
        type: row.type as Artifact["type"],
        content: row.content,
      })
    }
    if (rows.length > 0) {
      console.log(`[artifact-store] Loaded ${rows.length} artifacts from DB`)
    }
  } catch {
    // DB not initialized yet — first startup
  }
}

export function addArtifact(artifact: Artifact): void {
  loadFromDB()
  if (artifacts.size >= MAX_ARTIFACTS) {
    const oldest = artifacts.keys().next().value
    if (oldest) {
      artifacts.delete(oldest)
      try { deleteDBArtifact(oldest) } catch (e) { console.error("[artifact] Failed to delete oldest:", e) }
    }
  }
  artifacts.set(artifact.id, artifact)
  try {
    createDBArtifact({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      content: artifact.content,
      session_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
  } catch (e) { console.error("[artifact] Failed to create in DB:", e) }
}

export function getArtifact(id: string): Artifact | undefined {
  loadFromDB()
  return artifacts.get(id)
}

export function listArtifacts(): Artifact[] {
  loadFromDB()
  return Array.from(artifacts.values())
}

export function updateArtifact(id: string, updates: Partial<Pick<Artifact, "title" | "content" | "type">>): boolean {
  loadFromDB()
  const existing = artifacts.get(id)
  if (!existing) return false
  artifacts.set(id, { ...existing, ...updates })
  try {
    updateDBArtifact(id, {
      ...updates,
      updated_at: Date.now(),
    })
  } catch (e) { console.error("[artifact] Failed to update in DB:", e) }
  return true
}

export function deleteArtifact(id: string): boolean {
  loadFromDB()
  const removed = artifacts.delete(id)
  if (removed) {
    try { deleteDBArtifact(id) } catch (e) { console.error("[artifact] Failed to delete from DB:", e) }
  }
  return removed
}

export function clearArtifacts(): void {
  artifacts.clear()
  try {
    const rows = listDBArtifacts()
    for (const row of rows) {
      deleteDBArtifact(row.id)
    }
  } catch (e) { console.error("[artifact] Failed to clear DB:", e) }
}
