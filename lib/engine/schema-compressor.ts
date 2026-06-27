interface SchemaConfig {
  maxDescriptionLength: number
  shortenDescriptions: boolean
  useShortParamNames?: boolean
}

const PROVIDER_CONFIGS: Record<string, SchemaConfig> = {
  groq: { maxDescriptionLength: 100, shortenDescriptions: true, useShortParamNames: false },
  cerebras: { maxDescriptionLength: 100, shortenDescriptions: true, useShortParamNames: false },
  sambanova: { maxDescriptionLength: 100, shortenDescriptions: true, useShortParamNames: false },
  cloudflare: { maxDescriptionLength: 120, shortenDescriptions: true, useShortParamNames: false },
  openai: { maxDescriptionLength: 200, shortenDescriptions: false, useShortParamNames: false },
  anthropic: { maxDescriptionLength: 200, shortenDescriptions: false, useShortParamNames: false },
  google: { maxDescriptionLength: 200, shortenDescriptions: false, useShortParamNames: false },
  nvidia: { maxDescriptionLength: 150, shortenDescriptions: true, useShortParamNames: false },
}

const DEFAULT_CONFIG: SchemaConfig = {
  maxDescriptionLength: 150,
  shortenDescriptions: true,
  useShortParamNames: false,
}

const DESCRIPTION_SHORTENER: Record<string, string> = {
  "Read the contents of a file (relative path). Optionally specify offset (1-based line number) and limit (number of lines) to read a specific section instead of the entire file.": "Read file contents. Use offset/limit for sections.",
  "Write content to a file (relative path). CRITICAL: When creating a project or multiple related files (e.g., index.html, style.css, app.js), you MUST call this tool multiple times in PARALLEL within a single response step. Never write files one at a time.": "Write/create files. Batch parallel writes.",
  "Replace exact text in a file. Use for small, precise changes — fix a typo, update a variable name, change a single line. Provide the exact old_string to replace and the new_string to insert. For large changes, use write_file instead.": "Replace exact text. For large changes, use write_file.",
  "List files and directories at a path. Returns names, types, and sizes.": "List directory contents.",
  "Delete a file or empty directory.": "Delete file or empty directory.",
  "Create a new directory (and any missing parents).": "Create directory.",
  "Search for files by name pattern (glob). Returns matching file paths.": "Find files by name pattern.",
  "Execute a shell command and return stdout, stderr, and exit code.": "Run shell command.",
  "Store a structured document (plan, roadmap, spec, guide) for later retrieval.": "Store structured document.",
  "List all stored artifacts with IDs, titles, and types.": "List stored artifacts.",
  "Read the full content of a stored artifact.": "Read artifact content.",
  "Update an existing artifact's content or title.": "Update artifact.",
  "Ask the user a question with multiple choice options. Pauses execution until answered.": "Ask user question.",
  "Search past conversations for relevant facts, decisions, and project context.": "Search conversation history.",
  "Search file contents for a pattern. Returns matching lines with file paths and line numbers.": "Search file contents for pattern.",
  "Generate an image from a text description. Returns the image URL.": "Generate image from description.",
}

export function compressToolSchema(
  tool: { name: string; description: string; schema: Record<string, string> },
  provider: string
): { name: string; description: string; schema: Record<string, string> } {
  const config = PROVIDER_CONFIGS[provider] ?? DEFAULT_CONFIG

  let description = tool.description
  if (config.shortenDescriptions) {
    description = DESCRIPTION_SHORTENER[description] ?? description
  }
  if (description.length > config.maxDescriptionLength) {
    description = description.slice(0, config.maxDescriptionLength - 3) + "..."
  }

  const schema: Record<string, string> = {}
  for (const [key, value] of Object.entries(tool.schema)) {
    schema[key] = value
  }

  return { name: tool.name, description, schema }
}

export function compressToolSchemas(
  tools: Array<{ name: string; description: string; schema: Record<string, string> }>,
  provider: string
): Array<{ name: string; description: string; schema: Record<string, string> }> {
  return tools.map((t) => compressToolSchema(t, provider))
}
