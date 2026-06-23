export interface DBSession {
  id: string
  chat_id: string
  status: "active" | "completed" | "interrupted" | "error"
  model: string
  provider: string
  created_at: number
  updated_at: number
  metadata: string
}

export interface DBAgentStep {
  id: string
  session_id: string
  step_number: number
  input_tokens: number | null
  output_tokens: number | null
  finish_reason: string | null
  created_at: number
}

export interface DBToolCall {
  id: string
  step_id: string
  session_id: string
  tool_name: string
  args: string
  status: "pending" | "running" | "success" | "error"
  created_at: number
}

export interface DBToolResult {
  id: string
  tool_call_id: string
  step_id: string
  session_id: string
  success: number
  data: string | null
  error: string | null
  execution_time_ms: number | null
  created_at: number
}

export interface DBAgentEvent {
  id: number
  session_id: string
  event_type: string
  payload: string
  timestamp: number
}

export interface DBCompaction {
  id: string
  session_id: string
  step_range_start: number
  step_range_end: number
  summary: string
  created_at: number
}

export interface DBFileSnapshot {
  id: string
  session_id: string
  tool_call_id: string
  tool_name: string
  file_path: string
  original_content: string | null
  existed_before: number
  created_at: number
}

export interface DBArtifact {
  id: string
  title: string
  type: string
  content: string
  session_id: string | null
  created_at: number
  updated_at: number
}
