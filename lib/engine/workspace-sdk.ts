import { searchFilesTool } from "./tools/search-files"
import { readFileTool } from "./tools/read-file"
import { writeFileTool } from "./tools/write-file"
import { editFileTool } from "./tools/edit-file"
import { shellTool } from "./tools/shell"
import { listDirectoryTool } from "./tools/list-directory"
import type { ToolResult } from "./tools"

async function callTool<T>(toolName: string, args: unknown, executor: () => Promise<ToolResult>): Promise<T> {
  const result = await executor()
  if (!result.success) {
    throw new Error(result.error ?? `Tool "${toolName}" failed`)
  }
  return result.data as T
}

export class WorkspaceSDK {
  constructor(private emit?: (type: string, data: Record<string, unknown>) => void) {}

  private async run<T>(toolName: string, args: unknown, executor: () => Promise<ToolResult>): Promise<T> {
    this.emit?.("tool_start", { tool: toolName, args })
    try {
      const data = await callTool<T>(toolName, args, executor)
      this.emit?.("tool_end", { tool: toolName, status: "verified", result: data })
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      this.emit?.("tool_end", { tool: toolName, status: "error", error: msg })
      throw err
    }
  }

  findFiles(glob: string, path = "."): Promise<string[]> {
    return this.run<string[]>("search_files", { pattern: glob, path }, () =>
      searchFilesTool.execute({ pattern: glob, path })
    )
  }

  async readFile(path: string): Promise<string> {
    const result = await this.run<{ content: string }>("read_file", { path }, () =>
      readFileTool.execute({ path })
    )
    return result.content
  }

  async readFileSection(path: string, offset: number, limit: number): Promise<string> {
    const result = await this.run<{ content: string }>("read_file_section", { path, offset, limit }, () =>
      readFileTool.execute({ path, offset, limit })
    )
    return result.content
  }

  writeFile(path: string, content: string): Promise<void> {
    return this.run<void>("write_file", { path, content }, () =>
      writeFileTool.execute({ path, content })
    )
  }

  async patchFile(filePath: string, oldString: string, newString: string): Promise<boolean> {
    await this.run<{ path: string }>("edit_file", { path: filePath, old_string: oldString, new_string: newString }, () =>
      editFileTool.execute({ path: filePath, old_string: oldString, new_string: newString })
    )
    return true
  }

  executeCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.run<{ stdout: string; stderr: string; exitCode: number }>("shell", { command }, () =>
      shellTool.execute({ command })
    )
  }

  async listDirectory(path = "."): Promise<Array<{ name: string; type: string; size: number | null }>> {
    const result = await this.run<{ items: Array<{ name: string; type: string; size: number | null }> }>("list_directory", { path }, () =>
      listDirectoryTool.execute({ path })
    )
    return result.items
  }
}
