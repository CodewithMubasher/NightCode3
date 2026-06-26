import { Effect, Layer } from "effect"
import { ToolRegistry, ToolDef, ToolExecutionError, Logger } from "./nightcode-effect"

const toolMap = new Map<string, ToolDef>()

export const ToolRegistryLive = Layer.succeed(ToolRegistry, {
  register: (tool: ToolDef) =>
    Effect.sync(() => {
      toolMap.set(tool.name, tool)
    }),

  get: (name: string) =>
    Effect.sync(() => {
      const tool = toolMap.get(name)
      if (!tool) {
        throw new ToolExecutionError(name, `Unknown tool: ${name}`)
      }
      return tool
    }),

  list: () => Effect.sync(() => [...toolMap.values()]),

  execute: (name: string, args: Record<string, unknown>) =>
    Effect.flatMap(
      ToolRegistry,
      (registry) =>
        Effect.flatMap(
          registry.get(name),
          (tool) =>
            Effect.catchAll(
              tool.execute(args as any),
              (e) => Effect.fail(new ToolExecutionError(name, e.message, e.cause)),
            ),
        ),
    ),
})
