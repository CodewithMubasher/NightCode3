import type { ToolImplementation, ToolResult } from "./tools"

export async function executeTool(
  tool: ToolImplementation,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const start = performance.now()
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<ToolResult>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Tool execution timed out after 30 seconds")), 30_000)
    })
    let result: ToolResult
    try {
      result = await Promise.race([tool.execute(args), timeout])
    } finally {
      clearTimeout(timer)
    }
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
