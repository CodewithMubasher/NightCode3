import * as path from "path"

const WORKSPACE = path.resolve(process.env.BUILD_WORKSPACE || process.cwd())

export function getWorkspace(): string {
  return WORKSPACE
}

export function resolvePath(filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    // Relative path: resolve against workspace, reject traversal
    const resolved = path.resolve(WORKSPACE, filePath)
    const normalized = path.normalize(resolved)
    if (!normalized.startsWith(WORKSPACE)) {
      throw new Error(
        `Path traversal denied: "${filePath}" would escape the workspace. ` +
        `Workspace: ${WORKSPACE}`
      )
    }
    return normalized
  }

  // Absolute path: resolve directly, check for parent refs
  const normalized = path.normalize(filePath)
  if (normalized.includes("..") || filePath.includes("..")) {
    throw new Error(`Path traversal denied: "${filePath}" uses parent directory references`)
  }

  return normalized
}

/**
 * Check if a path is inside the workspace.
 * Returns true for paths at or under WORKSPACE.
 */
export function isInsideWorkspace(filePath: string): boolean {
  try {
    const resolved = resolvePath(filePath)
    return resolved.startsWith(WORKSPACE)
  } catch {
    return false
  }
}

/**
 * Get a relative path from workspace root.
 * If the path is outside the workspace, returns the absolute path.
 */
export function relativePath(filePath: string): string {
  try {
    const resolved = resolvePath(filePath)
    if (resolved.startsWith(WORKSPACE)) {
      return path.relative(WORKSPACE, resolved) || "."
    }
    return resolved
  } catch {
    return filePath
  }
}
