import type { ToolImplementation, ToolResult } from "./tools"

export async function executeTool(
  tool: ToolImplementation,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const start = performance.now()
  try {
    const timeout = new Promise<ToolResult>((_, reject) =>
      setTimeout(() => reject(new Error("Tool execution timed out after 30 seconds")), 30_000)
    )
    const result = await Promise.race([tool.execute(args), timeout])
    const executionTime = performance.now() - start
    if (result.success) {
      return { ...result, data: { ...result.data, executionTime } }
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Tool execution failed",
    }
  }
}
