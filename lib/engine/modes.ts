export interface ToolDef {
  name: string
}

export interface ModeConfig {
  tools: ToolDef[]
  maxIterations: number
  allowAutoFix: boolean
  retryPolicy: "none" | "lenient" | "strict"
  intentDefault: "tool_required" | "tool_optional" | "tool_forbidden"
}

export const MODE_CONFIGS: Record<string, ModeConfig> = {
  chat: {
    tools: [],
    maxIterations: 1,
    allowAutoFix: false,
    retryPolicy: "none",
    intentDefault: "tool_forbidden",
  },
  plan: {
    tools: [{ name: "think" }, { name: "create_artifact" }],
    maxIterations: 5,
    allowAutoFix: false,
    retryPolicy: "lenient",
    intentDefault: "tool_optional",
  },
  build: {
    tools: [
      { name: "read_file" },
      { name: "write_file" },
      { name: "list_directory" },
      { name: "delete_file" },
      { name: "create_folder" },
      { name: "search_files" },
      { name: "execute_command" },
    ],
    maxIterations: 10,
    allowAutoFix: true,
    retryPolicy: "strict",
    intentDefault: "tool_required",
  },
}
