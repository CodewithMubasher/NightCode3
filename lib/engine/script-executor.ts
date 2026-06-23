import * as esbuild from "esbuild"

export interface ScriptResult {
  success: boolean
  logs: string[]
  data?: unknown
  error?: string
}

export async function executeScript(
  code: string,
  workspaceSDK: unknown,
  signal?: AbortSignal
): Promise<ScriptResult> {
  const logs: string[] = []
  const capturedConsole = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => logs.push("[ERROR] " + args.map(String).join(" ")),
    warn: (...args: unknown[]) => logs.push("[WARN] " + args.map(String).join(" ")),
  }

  const result = await esbuild.transform(code, {
    loader: "ts",
    format: "cjs",
    target: "node18",
  })

  const wrappedCode = `
    const __console__ = __consoleImpl__;
    const console = __console__;
    return (async (Workspace) => {
      try {
        ${result.code}
        if (typeof run === "function") {
          return await run(Workspace);
        }
      } catch (err) {
        __console__.error(err?.message ?? String(err));
        throw err;
      }
    })(workspaceSDK);
  `

  const runner = new Function("workspaceSDK", "__consoleImpl__", wrappedCode)

  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Script execution timed out after 30s")),
      30_000
    )
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new Error("Script execution aborted"))
        return
      }
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(new Error("Script execution aborted"))
        },
        { once: true }
      )
    }
  })

  try {
    const data = await Promise.race([runner(workspaceSDK, capturedConsole), timeout])
    return { success: true, logs, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown execution error"
    if (!logs.some((l) => l.includes(message))) {
      logs.push("[FATAL] " + message)
    }
    return { success: false, logs, error: message }
  }
}
