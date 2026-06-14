export const createArtifactTool = {
  name: "create_artifact",
  description: "Create a rich document like a PRD, architecture plan, technical spec, or any structured content. The artifact appears in the artifact panel for the user to view, download, or copy.",
  schema: { title: "string", type: "string", content: "string" },
  async execute(args: { title: string; type: string; content: string }) {
    if (!args.title) return { success: false, error: "title is required" }
    if (!args.content) return { success: false, error: "content is required" }
    const validTypes = ["markdown", "code", "html", "svg", "mermaid"]
    if (!validTypes.includes(args.type)) return { success: false, error: `type must be one of: ${validTypes.join(", ")}` }
    return { success: true, data: { title: args.title, type: args.type, content: args.content } }
  },
  async verify(_args: { title: string; type: string; content: string }, result: { success: boolean; data?: { title: string; type: string; content: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!result.data?.title || !result.data?.content) return { verified: false, discrepancy: "Missing title or content in result" }
    return { verified: true, evidence: { title: result.data.title, type: result.data.type, length: result.data.content.length } }
  },
}
