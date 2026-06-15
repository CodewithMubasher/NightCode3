export const createArtifactTool = {
  name: "create_artifact",
  description: "Create a rich document like a PRD, architecture plan, technical spec, or any structured content. The artifact appears in the artifact panel for the user to view, download, or copy.",
  schema: { title: "string", type: "string", content: "string" },
  async execute(args: { title: string; type: string; content: string }) {
    if (!args.content && !args.title) {
      console.error("[create_artifact] Missing both title and content. Args:", JSON.stringify(args).slice(0, 500))
      return { success: false, error: "title and content are required" }
    }
    const title = (args.title || "Untitled").trim()
    const type = (args.type || "markdown").trim()
    const content = (args.content || args.title || "").trim()
    const validTypes = ["markdown", "code", "html", "svg", "mermaid"]
    if (!validTypes.includes(type)) {
      console.error(`[create_artifact] Invalid type "${type}" for title "${title}". Args preview:`, JSON.stringify(args).slice(0, 300))
      return { success: false, error: `type must be one of: ${validTypes.join(", ")}` }
    }
    if (!content) {
      console.error(`[create_artifact] Empty content for title "${title}". Args:`, JSON.stringify(args).slice(0, 300))
      return { success: false, error: "content is required" }
    }
    console.log(`[create_artifact] Success: title="${title.slice(0, 50)}", type=${type}, content.length=${content.length}`)
    return { success: true, data: { title, type, content } }
  },
  async verify(_args: { title: string; type: string; content: string }, result: { success: boolean; data?: { title: string; type: string; content: string } }) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!result.data?.title || !result.data?.content) return { verified: false, discrepancy: "Missing title or content in result" }
    return { verified: true, evidence: { title: result.data.title, type: result.data.type, length: result.data.content.length } }
  },
}
