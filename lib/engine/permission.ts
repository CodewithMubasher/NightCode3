export interface PermissionRequest {
  tool: string
  args: Record<string, unknown>
  reason: string
}

export interface PermissionResponse {
  allowed: boolean
  remember?: boolean
}

const DANGEROUS_TOOLS: Record<string, (args: Record<string, unknown>) => string | null> = {
  delete_file: (args) => {
    const path = args.path as string
    if (path?.includes("..") || path?.startsWith("/")) {
      return `Delete outside workspace: ${path}`
    }
    return `Delete file: ${path}`
  },
  shell: (args) => {
    const cmd = args.command as string
    if (!cmd) return null
    const dangerous = ["rm -rf", "rmdir /s", "del /f", "format", "mkfs", "dd if=", "> /dev/"]
    for (const d of dangerous) {
      if (cmd.toLowerCase().includes(d)) {
        return `Dangerous command: ${cmd}`
      }
    }
    return `Execute: ${cmd}`
  },
  create_folder: (args) => {
    const path = args.path as string
    if (path?.includes("..") || path?.startsWith("/")) {
      return `Create outside workspace: ${path}`
    }
    return null
  },
}

const permissionCache = new Map<string, boolean>()

export function needsPermission(tool: string, args: Record<string, unknown>): PermissionRequest | null {
  const checker = DANGEROUS_TOOLS[tool]
  if (!checker) return null

  const reason = checker(args)
  if (!reason) return null

  const cacheKey = `${tool}:${JSON.stringify(args)}`
  if (permissionCache.has(cacheKey)) {
    return null
  }

  return { tool, args, reason }
}

export function rememberPermission(tool: string, args: Record<string, unknown>, allowed: boolean): void {
  const cacheKey = `${tool}:${JSON.stringify(args)}`
  permissionCache.set(cacheKey, allowed)
}

export function clearPermissionCache(): void {
  permissionCache.clear()
}
