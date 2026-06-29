import { z } from "zod"
import type { AskQuestion } from "@/types"

function parseFlatQuestions(input: string): AskQuestion[] {
  const blocks = input.split("\n\n").filter(Boolean)
  const questions: AskQuestion[] = []
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) continue
    const qText = lines[0]
    const options: Array<{ label: string; value: string }> = []
    for (const line of lines.slice(1)) {
      const match = line.match(/^([a-z])[.)]\s*(.+)/i)
      if (match) {
        options.push({ label: match[2], value: match[1].toLowerCase() })
      } else {
        options.push({ label: line, value: line.toLowerCase().replace(/\s+/g, "-") })
      }
    }
    if (options.length > 0) {
      questions.push({
        id: `q${i + 1}`,
        question: qText,
        type: "select",
        options,
      })
    }
  }
  return questions
}

export const askTool = {
  name: "ask",
  description: `Ask the user a series of clarifying questions before building. For complex or ambiguous requests, gather requirements first. Each question should have multiple-choice options (maximum 4 per question, keep them short and simple). Do NOT build anything until all questions are answered.

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
    questions: z.array(z.object({
      id: z.string(),
      question: z.string(),
      type: z.enum(["select", "multiselect", "text"]).optional(),
      options: z.array(z.object({
        label: z.string(),
        value: z.string(),
        description: z.string().optional(),
      })).optional(),
      allowCustom: z.boolean().optional(),
    })),
  },
  async execute(args: { questions: string | AskQuestion[] | any[] }) {
    let parsed: AskQuestion[]
    if (typeof args.questions === "string") {
      try {
        parsed = JSON.parse(args.questions) as AskQuestion[]
      } catch {
        const fallback = parseFlatQuestions(args.questions)
        if (fallback.length > 0) {
          parsed = fallback
        } else {
          return { success: false, error: "Invalid questions JSON" }
        }
      }
    } else if (Array.isArray(args.questions)) {
      parsed = args.questions as AskQuestion[]
    } else {
      return { success: false, error: "Questions must be a JSON string or array" }
    }
    return { success: true, data: { action: "ask", questions: parsed } }
  },
  async verify() {
    return { verified: true }
  },
}
