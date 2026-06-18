import { readFileTool } from "./read-file"
import { writeFileTool } from "./write-file"
import { listDirectoryTool } from "./list-directory"
import { deleteFileTool } from "./delete-file"
import { createFolderTool } from "./create-folder"
import { searchFilesTool } from "./search-files"
import { executeCommandTool } from "./execute-command"
import { thinkTool } from "./think"
import { createArtifactTool } from "./create-artifact"
import { askTool } from "./ask"
import { listArtifactsTool, readArtifactTool, editArtifactTool } from "./artifact-tools"
import { searchMemoriesTool } from "./search-memories"

export interface ToolImplementation {
  name: string
  description: string
  schema: Record<string, string>
  execute: (args: any) => Promise<ToolResult>
  verify: (args: any, result: any) => Promise<VerificationResult>
}

export type ToolResult = {
  success: boolean
  data?: any
  error?: string
  executionTime?: number
}

export interface VerificationResult {
  verified: boolean
  evidence?: Record<string, unknown>
  discrepancy?: string
}

export const TOOL_REGISTRY: Record<string, ToolImplementation> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  list_directory: listDirectoryTool,
  delete_file: deleteFileTool,
  create_folder: createFolderTool,
  search_files: searchFilesTool,
  execute_command: executeCommandTool,
  think: thinkTool,
  create_artifact: createArtifactTool,
  ask: askTool,
  list_artifacts: listArtifactsTool,
  read_artifact: readArtifactTool,
  edit_artifact: editArtifactTool,
  search_memories: searchMemoriesTool,
}
