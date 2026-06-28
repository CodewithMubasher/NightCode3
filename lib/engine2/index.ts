// ───────────────────────────────────────────────
// Engine2 entry point & bridge to NightCode formats
// ───────────────────────────────────────────────

export { Session, generateId } from "./session"
export { runEngine } from "./main-loop"
export { createAdapter } from "./adapter"
export { dispatchTool, dispatchTools } from "./tool-runtime"
export * from "./types"
export { ProviderManager, providerManager } from "./provider/manager"
export { KeyPool, type KeyHealth } from "./provider/key-pool"
export { HealthMonitor } from "./provider/health-monitor"
export { withRetry } from "./provider/retry-handler"
export { SlidingWindowCounter } from "./provider/rate-counter"
export { PROVIDER_CONFIGS, type ProviderConfig, type KeySlot } from "./provider/types"
export { CacheManager, SessionCache, FileCache, McpCache, type McpToolDef } from "./cache/index"
export { Telemetry, type ToolTelemetry } from "./telemetry"
export { ContextManager, type ContextReport } from "./context/manager"
export { WindowTracker, type WindowState } from "./context/window-tracker"
export { TokenCounter } from "./context/token-counter"
export { DecisionEngine, type ContextDecision } from "./context/decision-engine"
