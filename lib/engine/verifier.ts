import type { ToolImplementation, ToolResult, VerificationResult } from "./tools"

export async function verifyToolResult(
  tool: ToolImplementation,
  args: Record<string, unknown>,
  result: ToolResult
): Promise<VerificationResult> {
  if (!tool.verify) {
    return { verified: true, evidence: { note: "No verifier defined for this tool" } }
  }
  return tool.verify(args, result)
}
