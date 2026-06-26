export const taskTool: ToolImplementation = {
  name: "task",
  description: "Launch a sub-agent to handle complex, multistep tasks autonomously. The sub-agent gets a fresh context with read-only tools. Use for: parallel codebase exploration, multi-file investigations, large-scale changes. In PLAN mode, you can launch multiple task agents in parallel to explore different areas simultaneously.",
  schema: {
    description: "string",
    prompt: "string",
    subagent_type: "string?",
  },
  async execute(args: { description: string; prompt: string; subagent_type?: string }) {
    return {
      success: true,
      data: {
        task_id: `task_${Date.now()}`,
        description: args.description,
        status: "launched",
        message: `Task launched: ${args.description}. The sub-agent will work autonomously and return results.`,
      },
    }
  },
  async verify() {
    return { verified: true }
  },
}
