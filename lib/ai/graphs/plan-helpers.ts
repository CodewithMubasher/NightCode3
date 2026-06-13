export function detectArtifactType(
  filename: string
): "markdown" | "code" | "json" {
  if (filename.endsWith(".json")) return "json"
  if (
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    filename.endsWith(".js") ||
    filename.endsWith(".py") ||
    filename.endsWith(".css") ||
    filename.endsWith(".html") ||
    filename.endsWith(".sql") ||
    filename.endsWith(".yaml") ||
    filename.endsWith(".yml")
  )
    return "code"
  return "markdown"
}

export function shouldGenerateArtifact(
  _userRequest: string,
  _artifactName: string
): boolean {
  return true
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
