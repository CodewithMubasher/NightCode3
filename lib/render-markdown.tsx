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

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <CodeBlock key={`code-${i}`} content={codeBlockContent} />
        )
        codeBlockContent = ""
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeBlockLang = line.slice(3).trim()
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? "\n" : "") + line
      continue
    }

    if (line.trim() === "") {
      elements.push(<div key={`spacing-${i}`} className="h-2" />)
      continue
    }

    const trimmed = line.trim()

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

    if (line.startsWith("|") && line.endsWith("|")) {
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
        <code key={key++} className="rounded bg-muted/70 px-1 py-0.5 text-xs font-mono text-foreground">
          {codeMatch[1]}
        </code>
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

function CodeBlock({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative mb-2 mt-1.5">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 opacity-60 transition-opacity hover:opacity-80"
      >
        {copied ? (
          <span className="text-[11px] text-muted-foreground">Copied</span>
        ) : (
          <Copy size={14} />
        )}
      </button>
      <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/50 p-3 text-sm font-mono">
        <code>{content}</code>
      </pre>
    </div>
  )
}
