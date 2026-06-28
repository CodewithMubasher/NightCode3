export interface ToolDef {
  name: string
}

export interface ModeConfig {
  tools: ToolDef[]
  maxIterations: number
  allowAutoFix: boolean
  retryPolicy: "none" | "lenient" | "strict"
  intentDefault: "tool_required" | "tool_optional" | "tool_forbidden"
  modeType: "plan" | "build" | "caat"
}

export const PLAN_CONFIG: ModeConfig = {
  tools: [
    { name: "read_file" },
    { name: "list_directory" },
    { name: "search_files" },
    { name: "grep" },
    { name: "ask" },
    { name: "create_artifact" },
    { name: "list_artifacts" },
    { name: "read_artifact" },
    { name: "edit_artifact" },
    { name: "search_memories" },
    { name: "task" },
    { name: "plan_exit" },
  ],
  maxIterations: 30,
  allowAutoFix: false,
  retryPolicy: "strict",
  intentDefault: "tool_required",
  modeType: "plan",
}

export const AGENT_CONFIG: ModeConfig = {
  tools: [
    { name: "read_file" },
    { name: "write_file" },
    { name: "list_directory" },
    { name: "delete_file" },
    { name: "create_folder" },
    { name: "search_files" },
    { name: "shell" },
    { name: "create_artifact" },
    { name: "list_artifacts" },
    { name: "read_artifact" },
    { name: "edit_artifact" },
    { name: "ask" },
    { name: "search_memories" },
    { name: "grep" },
    { name: "edit_file" },
    { name: "generate_image" },
    { name: "task" },
    { name: "get_errors" },
    { name: "run_tests" },
  ],
  maxIterations: 20,
  allowAutoFix: true,
  retryPolicy: "lenient",
  intentDefault: "tool_optional",
  modeType: "build",
}

export const CAAT_CONFIG: ModeConfig = {
  tools: [
    { name: "execute_workspace_script" },
  ],
  maxIterations: 30,
  allowAutoFix: true,
  retryPolicy: "lenient",
  intentDefault: "tool_required",
  modeType: "caat",
}
