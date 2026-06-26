import { Effect, Layer } from "effect"
import { SessionService, SessionState, SessionMessage, Mode, InvestigationState, Logger } from "./nightcode-effect"
import * as fs from "fs"
import * as path from "path"

const SESSIONS_DIR = path.join(process.cwd(), ".db", "sessions")

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

function sessionPath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`)
}

// In-memory cache
const cache = new Map<string, SessionState>()

function load(id: string): SessionState {
  const cached = cache.get(id)
  if (cached) return cached

  const fp = sessionPath(id)
  if (fs.existsSync(fp)) {
    try {
      const state = JSON.parse(fs.readFileSync(fp, "utf-8")) as SessionState
      cache.set(id, state)
      return state
    } catch { /* fall through */ }
  }

  const fresh: SessionState = {
    id,
    messages: [],
    mode: "standard" as Mode,
    investigation: { visitedFiles: [], visitedDirs: [], discoveredFacts: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  ensureDir()
  fs.writeFileSync(fp, JSON.stringify(fresh, null, 2))
  cache.set(id, fresh)
  return fresh
}

function persist(state: SessionState): void {
  state.updatedAt = Date.now()
  ensureDir()
  fs.writeFileSync(sessionPath(state.id), JSON.stringify(state, null, 2))
  cache.set(state.id, state)
}

function makeToolResultMessage(tc: { toolCallId: string; toolName: string; output: unknown }): SessionMessage {
  return {
    role: "tool",
    content: { toolCallId: tc.toolCallId, toolName: tc.toolName, output: tc.output },
    id: tc.toolCallId,
    timestamp: Date.now(),
  }
}

export const SessionServiceLive = Layer.succeed(SessionService, {
  get: (id: string) => Effect.sync(() => load(id)),

  save: (state: SessionState) => Effect.sync(() => persist(state)),

  appendMessage: (sessionId: string, msg: SessionMessage) =>
    Effect.sync(() => {
      const state = load(sessionId)
      state.messages.push(msg)
      persist(state)
      return state
    }),

  updateMode: (sessionId: string, mode: Mode) =>
    Effect.sync(() => {
      const state = load(sessionId)
      state.mode = mode
      persist(state)
      return state
    }),

  getInvestigation: (sessionId: string) =>
    Effect.sync(() => {
      const state = load(sessionId)
      return state.investigation
    }),

  updateInvestigation: (sessionId: string, update: Partial<InvestigationState>) =>
    Effect.sync(() => {
      const state = load(sessionId)
      if (update.visitedFiles) {
        state.investigation.visitedFiles = [...new Set([...state.investigation.visitedFiles, ...update.visitedFiles])]
      }
      if (update.visitedDirs) {
        state.investigation.visitedDirs = [...new Set([...state.investigation.visitedDirs, ...update.visitedDirs])]
      }
      if (update.discoveredFacts) {
        state.investigation.discoveredFacts = [...new Set([...state.investigation.discoveredFacts, ...update.discoveredFacts])]
      }
      persist(state)
      return state.investigation
    }),
})
