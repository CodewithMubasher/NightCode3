import Database from "better-sqlite3"
import path from "path"
import os from "os"

function getDBDir(): string {
  const base = process.env.NIGHTCODE_DATA_DIR
    || process.env.APPDATA
    || (process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "NightCode")
      : path.join(os.homedir(), ".local", "share", "nightcode"))
  return path.join(base, "db")
}

const DB_DIR = getDBDir()
const DB_PATH = path.join(DB_DIR, "agent.db")
const SCHEMA_VERSION = 1

let db: Database.Database | null = null

function migrateFromOldPath(): void {
  try {
    const fs = require("fs")
    const oldPath = path.resolve(process.cwd(), ".db/agent.db")
    if (fs.existsSync(oldPath) && !fs.existsSync(DB_PATH)) {
      fs.mkdirSync(DB_DIR, { recursive: true })
      fs.copyFileSync(oldPath, DB_PATH)
      console.log(`[db] Migrated database from ${oldPath} to ${DB_PATH}`)
    }
  } catch (err) {
    console.error("[db] Failed to migrate from old path:", err)
  }
}

function ensureVersionTable(): void {
  if (!db) return
  const hasTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get()
  if (!hasTable) {
    db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)")
    db.prepare("INSERT INTO schema_version (version) VALUES (0)").run()
  }
}

function getVersion(): number {
  if (!db) return 0
  try {
    const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined
    return row?.version ?? 0
  } catch {
    return 0
  }
}

function applyMigrations(): void {
  if (!db) return
  const currentVersion = getVersion()

  if (currentVersion < 1) {
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

      CREATE TABLE IF NOT EXISTS file_snapshots (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL REFERENCES sessions(id),
        tool_call_id    TEXT NOT NULL,
        tool_name       TEXT NOT NULL,
        file_path       TEXT NOT NULL,
        original_content TEXT,
        existed_before  INTEGER NOT NULL DEFAULT 1,
        created_at      INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_steps_session ON agent_steps(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_step ON tool_calls(step_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_results_tool_call ON tool_results(tool_call_id);
      CREATE INDEX IF NOT EXISTS idx_events_session ON agent_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id);
      CREATE INDEX IF NOT EXISTS idx_file_snapshots_session ON file_snapshots(session_id);

      CREATE TABLE IF NOT EXISTS artifacts (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'markdown',
        content     TEXT NOT NULL DEFAULT '',
        session_id  TEXT REFERENCES sessions(id),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);

      CREATE TABLE IF NOT EXISTS account_keys (
        env_name      TEXT NOT NULL,
        key_value     TEXT NOT NULL,
        account_label TEXT NOT NULL DEFAULT 'default',
        updated_at    INTEGER NOT NULL,
        UNIQUE(env_name, account_label)
      );

      CREATE TABLE IF NOT EXISTS accounts (
        label TEXT PRIMARY KEY
      );

      INSERT OR IGNORE INTO accounts (label) VALUES ('default');

      CREATE TABLE IF NOT EXISTS provider_accounts (
        env_name       TEXT PRIMARY KEY,
        account_label  TEXT NOT NULL DEFAULT 'default'
      );
    `)

    db.prepare("UPDATE schema_version SET version = 1").run()
    console.log("[db] Migrated to schema version 1")
  }
}

export function getDb(): Database.Database {
  if (!db) {
    const fs = require("fs")
    migrateFromOldPath()
    fs.mkdirSync(DB_DIR, { recursive: true })
    db = new Database(DB_PATH)
    db.pragma("journal_mode = WAL")
    db.pragma("busy_timeout = 5000")
    db.pragma("foreign_keys = ON")
    ensureVersionTable()
    applyMigrations()
  }
  return db
}

export function initSchema(): void {
  getDb()
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
