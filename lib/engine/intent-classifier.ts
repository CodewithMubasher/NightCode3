export type Intent = "quick" | "deep"

const DEEP_KEYWORDS = [
  "refactor", "rewrite", "restructure", "redesign", "rebuild",
  "implement", "build", "create", "add feature", "new feature",
  "optimize", "migrate", "upgrade", "update dependencies",
  "fix bug", "debug", "troubleshoot", "investigate",
  "analyze", "audit", "review", "explain architecture",
  "compare", "change", "modify", "update",
  "test", "write tests", "add tests",
  "deploy", "configure", "setup", "initialize",
]

const QUICK_KEYWORDS = [
  "what is", "what does", "how does", "explain", "meaning of",
  "define", "tell me", "what's", "who", "when", "where",
  "summarize", "describe", "show me", "find",
  "hello", "hi", "thanks", "help",
]

export function classifyIntent(message: string): Intent {
  const lower = message.toLowerCase().trim()

  for (const kw of QUICK_KEYWORDS) {
    if (lower.startsWith(kw)) {
      const hasProjectRef = /file|code|project|repo|package|module|app/.test(lower)
      if (hasProjectRef) return "deep"
      return "quick"
    }
  }

  for (const kw of DEEP_KEYWORDS) {
    if (lower.includes(kw)) return "deep"
  }

  if (lower.length < 30) return "quick"

  return "deep"
}
