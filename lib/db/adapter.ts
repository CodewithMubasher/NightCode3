import { getDb } from "./schema"
import type {
  DBSession,
  DBAgentStep,
  DBToolCall,
  DBToolResult,
  DBAgentEvent,
  DBCompaction,
} from "./types"

// ─── Sessions ─────────────────────────────────────────────────────────────────

export function createSession(session: DBSession): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO sessions (id, chat_id, status, model, provider, created_at, updated_at, metadata)
    VALUES (@id, @chat_id, @status, @model, @provider, @created_at, @updated_at, @metadata)
  `).run(session)
}

export function getSession(id: string): DBSession | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as DBSession | undefined
}

export function updateSessionStatus(id: string, status: DBSession["status"]): void {
  getDb().prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id)
}

export function listSessionsByChat(chatId: string): DBSession[] {
  return getDb().prepare("SELECT * FROM sessions WHERE chat_id = ? ORDER BY created_at DESC").all(chatId) as DBSession[]
}

// ─── Agent Steps ──────────────────────────────────────────────────────────────

export function createStep(step: DBAgentStep): void {
  getDb().prepare(`
    INSERT INTO agent_steps (id, session_id, step_number, input_tokens, output_tokens, finish_reason, created_at)
    VALUES (@id, @session_id, @step_number, @input_tokens, @output_tokens, @finish_reason, @created_at)
  `).run(step)
}

export function getStepsBySession(sessionId: string): DBAgentStep[] {
  return getDb().prepare("SELECT * FROM agent_steps WHERE session_id = ? ORDER BY step_number ASC").all(sessionId) as DBAgentStep[]
}

export function getLatestStep(sessionId: string): DBAgentStep | undefined {
  return getDb().prepare("SELECT * FROM agent_steps WHERE session_id = ? ORDER BY step_number DESC LIMIT 1").get(sessionId) as DBAgentStep | undefined
}

// ─── Tool Calls ───────────────────────────────────────────────────────────────

export function createToolCall(tc: DBToolCall): void {
  getDb().prepare(`
    INSERT INTO tool_calls (id, step_id, session_id, tool_name, args, status, created_at)
    VALUES (@id, @step_id, @session_id, @tool_name, @args, @status, @created_at)
  `).run(tc)
}

export function updateToolCallStatus(id: string, status: DBToolCall["status"]): void {
  getDb().prepare("UPDATE tool_calls SET status = ? WHERE id = ?").run(status, id)
}

export function getToolCallsByStep(stepId: string): DBToolCall[] {
  return getDb().prepare("SELECT * FROM tool_calls WHERE step_id = ? ORDER BY created_at ASC").all(stepId) as DBToolCall[]
}

export function getToolCallsBySession(sessionId: string): DBToolCall[] {
  return getDb().prepare("SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as DBToolCall[]
}

// ─── Tool Results ─────────────────────────────────────────────────────────────

export function createToolResult(tr: DBToolResult): void {
  getDb().prepare(`
    INSERT INTO tool_results (id, tool_call_id, step_id, session_id, success, data, error, execution_time_ms, created_at)
    VALUES (@id, @tool_call_id, @step_id, @session_id, @success, @data, @error, @execution_time_ms, @created_at)
  `).run(tr)
}

export function getToolResultByToolCall(toolCallId: string): DBToolResult | undefined {
  return getDb().prepare("SELECT * FROM tool_results WHERE tool_call_id = ?").get(toolCallId) as DBToolResult | undefined
}

export function getToolResultsBySession(sessionId: string): DBToolResult[] {
  return getDb().prepare("SELECT * FROM tool_results WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as DBToolResult[]
}

// ─── Agent Events ─────────────────────────────────────────────────────────────

export function createEvent(event: Omit<DBAgentEvent, "id">): void {
  getDb().prepare(`
    INSERT INTO agent_events (session_id, event_type, payload, timestamp)
    VALUES (@session_id, @event_type, @payload, @timestamp)
  `).run(event)
}

export function getEventsBySession(sessionId: string): DBAgentEvent[] {
  return getDb().prepare("SELECT * FROM agent_events WHERE session_id = ? ORDER BY id ASC").all(sessionId) as DBAgentEvent[]
}

// ─── Compactions ──────────────────────────────────────────────────────────────

export function createCompaction(compaction: DBCompaction): void {
  getDb().prepare(`
    INSERT INTO compactions (id, session_id, step_range_start, step_range_end, summary, created_at)
    VALUES (@id, @session_id, @step_range_start, @step_range_end, @summary, @created_at)
  `).run(compaction)
}

export function getCompactionsBySession(sessionId: string): DBCompaction[] {
  return getDb().prepare("SELECT * FROM compactions WHERE session_id = ? ORDER BY step_range_start ASC").all(sessionId) as DBCompaction[]
}

// ─── cleanup ──────────────────────────────────────────────────────────────────

export function deleteSessionCascade(sessionId: string): void {
  const db = getDb()
  db.prepare("DELETE FROM compactions WHERE session_id = ?").run(sessionId)
  db.prepare("DELETE FROM agent_events WHERE session_id = ?").run(sessionId)
  db.prepare("DELETE FROM tool_results WHERE session_id = ?").run(sessionId)
  db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId)
  db.prepare("DELETE FROM agent_steps WHERE session_id = ?").run(sessionId)
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId)
}
