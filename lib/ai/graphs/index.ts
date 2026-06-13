import { createChatGraph } from "./chat"

export type Mode = "chat" | "plan" | "build"

export function getGraph(mode: Mode) {
  switch (mode) {
    case "chat":
      return createChatGraph()
    default:
      return createChatGraph()
  }
}
