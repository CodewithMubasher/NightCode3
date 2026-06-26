export const planExitTool = {
  name: "plan_exit",
  description: "Call this when you have finished exploring the codebase and are ready to start implementing. Only available in PLAN mode.",
  schema: { plan_summary: "string" },
  async execute(args: { plan_summary: string }) {
    return {
      success: true,
      data: {
        planSummary: args.plan_summary,
        _switchMode: "build",
      },
    }
  },
  async verify() {
    return { verified: true }
  },
}
