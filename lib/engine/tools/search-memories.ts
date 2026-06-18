import { listArtifacts } from "@/lib/engine/artifact-store"

export const searchMemoriesTool = {
  name: "search_memories",
  description: "Search all stored artifacts (memories, facts, decisions, project context) by keyword. Returns matching artifact IDs, titles, and relevant snippets. Use this before creating artifacts to avoid duplicates, and when the user references something from earlier conversations.",
  schema: { query: "string" },
  async execute(args: { query: string }) {
    const q = args.query.toLowerCase()
    const all = listArtifacts()
    const matches = all.filter((a) =>
      a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)
    )
    const results = matches.map((a) => {
      const idx = a.content.toLowerCase().indexOf(q)
      const snippet = idx !== -1
        ? a.content.slice(Math.max(0, idx - 80), idx + q.length + 80)
        : a.content.slice(0, 200)
      return {
        id: a.id,
        title: a.title,
        type: a.type,
        snippet: snippet.length < a.content.length ? snippet + "..." : snippet,
      }
    })
    return {
      success: true,
      data: {
        count: results.length,
        results,
      },
    }
  },
  async verify() {
    return { verified: true, evidence: {} }
  },
}
