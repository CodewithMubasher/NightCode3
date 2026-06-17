import type { AskQuestion } from "@/types"

export const askTool = {
  name: "ask",
  description: `Ask the user a series of clarifying questions before building. For complex or ambiguous requests, gather requirements first. Each question should have multiple-choice options. Do NOT build anything until all questions are answered.

Output a JSON array of question objects in the "questions" parameter. Each question has id, question text, and options array. Options have label and value fields.

Example questions JSON:
[
  {
    "id": "purpose",
    "question": "What's this website for?",
    "options": [
      { "label": "SaaS / Web App", "value": "saas" },
      { "label": "Portfolio / Personal", "value": "portfolio" },
      { "label": "Business / Landing Page", "value": "business" },
      { "label": "Marketplace / E-commerce", "value": "marketplace" }
    ]
  }
]`,
  schema: {
    questions: "string",
  },
  async execute(args: { questions: string }) {
    let parsed: AskQuestion[]
    try {
      parsed = JSON.parse(args.questions) as AskQuestion[]
    } catch {
      return { success: false, error: "Invalid questions JSON" }
    }
    return { success: true, data: { action: "ask", questions: parsed } }
  },
  async verify() {
    return { verified: true }
  },
}