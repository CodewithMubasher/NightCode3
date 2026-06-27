import type { ToolImplementation, ToolResult } from "./tools"

const TOOL_TIMEOUT_MS = 30_000

export async function executeTool(
  tool: ToolImplementation,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const start = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      tool.execute(args),
      new Promise<ToolResult>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool execution timed out after ${TOOL_TIMEOUT_MS / 1000} seconds`)), TOOL_TIMEOUT_MS)
      }),
    ])
    const executionTime = performance.now() - start
    if (result.success) {
      return { ...result, executionTime, data: result.data }
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Tool execution failed",
    }
  } finally {
    clearTimeout(timer)
  }
}
