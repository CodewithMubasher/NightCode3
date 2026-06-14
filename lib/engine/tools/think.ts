export const thinkTool = {
  name: "think",
  description: "Use this tool to reason through a problem, organize your thoughts, or plan your approach before responding. No actual side effects.",
  schema: { thought: "string" },
  async execute(args: { thought: string }) {
    return { success: true, data: { thought: args.thought } }
  },
  async verify(_args: { thought: string }, result: { success: boolean }) {
    return { verified: true, evidence: { thought: result.success ? "recorded" : "failed" } }
  },
}
