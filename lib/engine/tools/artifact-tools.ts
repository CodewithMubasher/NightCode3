import { listArtifacts, getArtifact, updateArtifact } from "@/lib/engine/artifact-store"

export const listArtifactsTool = {
  name: "list_artifacts",
  description: "List all stored artifacts with their IDs, titles, and types.",
  schema: {},
  async execute() {
    const items = listArtifacts()
    return {
      success: true,
      data: {
        count: items.length,
        artifacts: items.map((a) => ({ id: a.id, title: a.title, type: a.type, contentLength: a.content.length })),
      },
    }
  },
  async verify() {
    return { verified: true, evidence: {} }
  },
}

export const readArtifactTool = {
  name: "read_artifact",
  description: "Read the full content of a stored artifact by its ID. Use list_artifacts first to get available IDs.",
  schema: { id: "string" },
  async execute(args: { id: string }) {
    const artifact = getArtifact(args.id)
    if (!artifact) return { success: false, error: `Artifact "${args.id}" not found` }
    return { success: true, data: artifact }
  },
  async verify(_args: { id: string }, result: { success: boolean; data?: { id: string; title: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Artifact not found" }
    return { verified: true, evidence: { title: result.data?.title } }
  },
}

export const editArtifactTool = {
  name: "edit_artifact",
  description: "Edit an existing artifact's title, type, or content by its ID. All fields are optional — only provided fields are updated.",
  schema: { id: "string", title: "string", type: "string", content: "string" },
  async execute(args: { id: string; title?: string; type?: string; content?: string }) {
    const updates: Record<string, unknown> = {}
    if (args.title !== undefined) updates.title = args.title
    if (args.type !== undefined) updates.type = args.type
    if (args.content !== undefined) updates.content = args.content
    const ok = updateArtifact(args.id, updates)
    if (!ok) return { success: false, error: `Artifact "${args.id}" not found` }
    const artifact = getArtifact(args.id)
    return { success: true, data: artifact }
  },
  async verify(_args: { id: string }, result: { success: boolean; data?: { id: string; title: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Artifact not found" }
    return { verified: true, evidence: { title: result.data?.title } }
  },
}
