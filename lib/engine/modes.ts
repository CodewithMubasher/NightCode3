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

export const AGENT_CONFIG: ModeConfig = {
  tools: [
    { name: "read_file" },
    { name: "write_file" },
    { name: "list_directory" },
    { name: "delete_file" },
    { name: "create_folder" },
    { name: "search_files" },
    { name: "execute_command" },
    { name: "think" },
    { name: "create_artifact" },
    { name: "generate_image" },
  ],
  maxIterations: 20,
  allowAutoFix: true,
  retryPolicy: "lenient",
  intentDefault: "tool_optional",
}
