import { createChatGraph } from "./chat"
import { createPlanGraph } from "./plan"

export type Mode = "chat" | "plan" | "build"

export function getGraph(mode: Mode) {
  switch (mode) {
    case "plan":
      return createPlanGraph()
    case "chat":
      return createChatGraph()
    default:
      return createChatGraph()
  }
}
