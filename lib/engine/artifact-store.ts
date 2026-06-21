import type { Artifact } from "@/types"

const artifacts = new Map<string, Artifact>()
const MAX_ARTIFACTS = 200

export function addArtifact(artifact: Artifact): void {
  if (artifacts.size >= MAX_ARTIFACTS) {
    const oldest = artifacts.keys().next().value
    if (oldest) artifacts.delete(oldest)
  }
  artifacts.set(artifact.id, artifact)
}

export function getArtifact(id: string): Artifact | undefined {
  return artifacts.get(id)
}

export function listArtifacts(): Artifact[] {
  return Array.from(artifacts.values())
}

export function updateArtifact(id: string, updates: Partial<Pick<Artifact, "title" | "content" | "type">>): boolean {
  const existing = artifacts.get(id)
  if (!existing) return false
  artifacts.set(id, { ...existing, ...updates })
  return true
}

export function deleteArtifact(id: string): boolean {
  return artifacts.delete(id)
}

export function clearArtifacts(): void {
  artifacts.clear()
}
