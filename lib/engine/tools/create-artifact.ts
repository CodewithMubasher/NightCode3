export const createArtifactTool = {
  name: "create_artifact",
  description: "Create a rich document like a PRD, architecture plan, technical spec, or any structured content. The artifact appears in the artifact panel for the user to view, download, or copy.",
  schema: { title: "string", type: "string", content: "string" },
  async execute(args: { title: string; type: string; content: string }) {
    if (!args.content && !args.title) {
      return { success: false, error: "title and content are required" }
    }
    const title = (args.title || "Untitled").trim()
    const validTypes = ["markdown", "code", "html", "svg", "mermaid"]
    const type = validTypes.includes(args.type.trim()) ? args.type.trim() : "markdown"
    const content = (args.content || args.title || "").trim()
    if (!content) {
      return { success: false, error: "content is required" }
    }
    return { success: true, data: { title, type, content } }
  },
  async verify(_args: { title: string; type: string; content: string }, result: { success: boolean; data?: { title: string; type: string; content: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!result.data?.title || !result.data?.content) return { verified: false, discrepancy: "Missing title or content in result" }
    return { verified: true, evidence: { title: result.data.title, type: result.data.type, length: result.data.content.length } }
  },
}
