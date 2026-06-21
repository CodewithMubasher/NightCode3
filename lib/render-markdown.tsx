import { useState, type ReactNode } from "react"
import { Copy } from "lucide-react"

export function renderInlineMarkdown(content: string): ReactNode {
  const lines = content.split("\n")
  const elements: ReactNode[] = []
  let inCodeBlock = false
  let codeBlockContent = ""
  let codeBlockLang = ""

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <CodeBlock key={`code-${i}`} content={codeBlockContent} lang={codeBlockLang} />
        )
        codeBlockContent = ""
        codeBlockLang = ""
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeBlockLang = trimmed.slice(3).trim()
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? "\n" : "") + line
      continue
    }

    if (trimmed === "") {
      elements.push(<div key={`spacing-${i}`} className="h-2" />)
      continue
    }

    if (trimmed.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="mb-1 mt-4 text-base font-semibold">{trimmed.slice(4)}</h3>
      )
      continue
    }

    if (trimmed.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${i}`} className="mb-1 mt-5 text-lg font-semibold">{trimmed.slice(3)}</h2>
      )
      continue
    }

    if (trimmed.startsWith("# ")) {
      elements.push(
        <h1 key={`h1-${i}`} className="mb-1 mt-5 text-xl font-bold">{trimmed.slice(2)}</h1>
      )
      continue
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [trimmed.slice(2)]
      let j = i + 1
      while (j < lines.length && (lines[j].trim().startsWith("- ") || lines[j].trim().startsWith("* "))) {
        items.push(lines[j].trim().slice(2))
        j++
      }
      elements.push(
        <ul key={`ul-${i}`} className="mb-2 mt-1 list-disc pl-5 text-sm space-y-0.5">
          {items.map((item, k) => (
            <li key={k}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      )
      i = j - 1
      continue
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [trimmed.replace(/^\d+\.\s/, "")]
      let j = i + 1
      while (j < lines.length && /^\d+\.\s/.test(lines[j].trim())) {
        items.push(lines[j].trim().replace(/^\d+\.\s/, ""))
        j++
      }
      elements.push(
        <ol key={`ol-${i}`} className="mb-2 mt-1 list-decimal pl-5 text-sm space-y-0.5">
          {items.map((item, k) => (
            <li key={k}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      i = j - 1
      continue
    }

    if (trimmed.startsWith("> ")) {
      elements.push(
        <blockquote key={`bq-${i}`} className="mb-2 mt-1 border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      )
      continue
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const rows: string[][] = []
      let j = i
      while (j < lines.length && lines[j].startsWith("|") && lines[j].endsWith("|")) {
        rows.push(lines[j].split("|").filter(Boolean).map((c) => c.trim()))
        j++
      }
      if (rows.length >= 2) {
        const [header, ...body] = rows
        elements.push(
          <table key={`table-${i}`} className="mb-3 mt-2 w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/50">
                {header.map((h, k) => (
                  <th key={k} className="px-3 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, k) => (
                <tr key={k} className="border-b border-border/30 last:border-0">
                  {row.map((cell, l) => (
                    <td key={l} className="px-3 py-1.5">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
        i = j - 1
        continue
      }
    }

    const inline = renderInline(content, line)
    elements.push(
      <p key={`p-${i}`} className="mb-2 last:mb-0">
        {inline}
      </p>
    )
  }

  return elements
}

function renderInline(fullContent: string, line: string): ReactNode {
  const parts: ReactNode[] = []
  let remaining = line
  let key = 0

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      parts.push(
        <span
          key={key++}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.3 text-[12px] font-sans"
          style={{
            background: "#1A1A1A",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#B3B3B3",
          }}
        >
          {codeMatch[1]}
        </span>
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    const italicMatch = remaining.match(/^_([^_]+)_/)
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>)
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      parts.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#0099ff] hover:underline"
        >
          {linkMatch[1]}
        </a>
      )
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    parts.push(remaining[0])
    remaining = remaining.slice(1)
  }

  return parts
}

const KEYWORD_MAP: Record<string, string[]> = {
  bash: ["if", "then", "else", "fi", "for", "while", "do", "done", "in", "function", "return", "local", "export", "source", "echo", "exit", "cd", "mkdir", "rm", "cp", "mv", "touch", "cat", "grep", "sed", "awk", "npm", "npx", "yarn", "pnpm", "node", "python", "pip", "docker", "git", "curl", "wget"],
  js: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "this", "async", "await", "import", "export", "from", "class", "extends", "try", "catch", "throw", "typeof", "instanceof", "true", "false", "null", "undefined", "require", "module"],
  ts: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "this", "async", "await", "import", "export", "from", "class", "extends", "interface", "type", "implements", "try", "catch", "throw", "typeof", "instanceof", "true", "false", "null", "undefined", "enum", "readonly", "public", "private", "protected", "abstract", "static"],
  python: ["def", "class", "return", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "as", "import", "from", "async", "await", "True", "False", "None", "in", "is", "not", "and", "or", "pass", "raise", "yield", "lambda", "self", "print", "len", "range", "int", "str", "list", "dict", "set", "tuple"],
  json: ["true", "false", "null"],
  html: ["html", "head", "body", "div", "span", "p", "a", "img", "ul", "ol", "li", "table", "tr", "td", "th", "form", "input", "button", "script", "style", "link", "meta", "title", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "nav", "header", "footer", "main", "aside", "class", "id", "href", "src", "alt", "rel", "type"],
  css: ["@import", "@media", "@keyframes", "color", "background", "margin", "padding", "border", "display", "flex", "grid", "position", "top", "left", "right", "bottom", "width", "height", "font", "text", "transform", "transition", "animation", "opacity", "overflow", "z-index", "important"],
  sql: ["SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "AS", "DISTINCT", "COUNT", "SUM", "AVG", "MAX", "MIN", "NULL", "IS", "EXISTS", "UNION", "ALL", "CASE", "WHEN", "THEN", "ELSE", "END"],
}

function highlightLine(line: string, lang: string): ReactNode[] {
  const keywords = KEYWORD_MAP[lang] ?? []
  if (keywords.length === 0) return [line]

  const parts: ReactNode[] = []
  const tokenRegex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#.*$|[a-zA-Z_$][\w$]*|[^\s\w]+|\s+)/g
  let match: RegExpExecArray | null
  let key = 0

  while ((match = tokenRegex.exec(line)) !== null) {
    const token = match[0]
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      parts.push(<span key={key++} style={{ color: "#ce9178" }}>{token}</span>)
    } else if (token.startsWith("//") || token.startsWith("#")) {
      parts.push(<span key={key++} style={{ color: "#6a9955" }}>{token}</span>)
    } else if (token.startsWith("/*")) {
      parts.push(<span key={key++} style={{ color: "#6a9955" }}>{token}</span>)
    } else if (keywords.includes(token)) {
      parts.push(<span key={key++} style={{ color: "#569cd6" }}>{token}</span>)
    } else if (/^\d+(\.\d+)?$/.test(token)) {
      parts.push(<span key={key++} style={{ color: "#b5cea8" }}>{token}</span>)
    } else {
      parts.push(token)
    }
  }

  return parts.length > 0 ? parts : [line]
}

function CodeBlock({ content, lang }: { content: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const lines = content.split("\n")

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative mb-2 mt-1.5">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border/50 bg-muted/30 px-3 py-1.5">
        {lang ? (
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            {lang}
          </span>
        ) : (
          <span />
        )}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        >
          {copied ? (
            <span className="text-[11px] text-muted-foreground">Copied</span>
          ) : (
            <>
              <Copy size={12} />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-b-lg border border-border/50 bg-[#0d1117] p-3 text-sm font-mono leading-relaxed">
        <code>
          {lang && KEYWORD_MAP[lang]
            ? lines.map((line, i) => (
                <span key={i}>
                  {highlightLine(line, lang)}
                  {i < lines.length - 1 && "\n"}
                </span>
              ))
            : content}
        </code>
      </pre>
    </div>
  )
}
