import Database from "better-sqlite3"
import path from "path"

const DB_PATH = path.resolve(process.cwd(), ".db/agent.db")

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const fs = require("fs")
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    db = new Database(DB_PATH)
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")
  }
  return db
}

export function initSchema(): void {
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id        TEXT PRIMARY KEY,
      chat_id   TEXT NOT NULL,
      status    TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','completed','interrupted','error')),
      model     TEXT NOT NULL,
      provider  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata  TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS agent_steps (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES sessions(id),
      step_number  INTEGER NOT NULL,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      finish_reason TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id         TEXT PRIMARY KEY,
      step_id    TEXT NOT NULL REFERENCES agent_steps(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      tool_name  TEXT NOT NULL,
      args       TEXT NOT NULL DEFAULT '{}',
      status     TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending','running','success','error')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_results (
      id              TEXT PRIMARY KEY,
      tool_call_id    TEXT NOT NULL REFERENCES tool_calls(id),
      step_id         TEXT NOT NULL REFERENCES agent_steps(id),
      session_id      TEXT NOT NULL REFERENCES sessions(id),
      success         INTEGER NOT NULL DEFAULT 0,
      data            TEXT,
      error           TEXT,
      execution_time_ms INTEGER,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      event_type TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '{}',
      timestamp  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compactions (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id),
      step_range_start INTEGER NOT NULL,
      step_range_end   INTEGER NOT NULL,
      summary         TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_steps_session ON agent_steps(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_step ON tool_calls(step_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_results_tool_call ON tool_results(tool_call_id);
    CREATE INDEX IF NOT EXISTS idx_events_session ON agent_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id);
  `)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
