import { createChatGraph } from "./chat"
import { createPlanGraph } from "./plan"
import { createBuildGraph } from "./build"

export type Mode = "chat" | "plan" | "build"

export function getGraph(mode: Mode) {
  switch (mode) {
    case "plan":
      return createPlanGraph()
    case "build":
      return createBuildGraph()
    case "chat":
    default:
      return createChatGraph()
  }
}
