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

    // ── Code fence ──────────────────────────────────────────────────────
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

    // ── Horizontal rule  (---, ***, ___) ───────────────────────────────
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) {
      elements.push(
        <hr key={`hr-${i}`} className="my-3 border-0 border-t border-white/10" />
      )
      continue
    }

    // ── Empty line ───────────────────────────────────────────────────────
    if (trimmed === "") {
      elements.push(<div key={`spacing-${i}`} className="h-1.5" />)
      continue
    }

    // ── Headings ─────────────────────────────────────────────────────────
    if (trimmed.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="mb-1 mt-4 text-[15px] font-semibold text-white/90">
          {renderInline(trimmed.slice(4))}
        </h3>
      )
      continue
    }

    if (trimmed.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${i}`} className="mb-1 mt-5 text-[17px] font-semibold text-white/90">
          {renderInline(trimmed.slice(3))}
        </h2>
      )
      continue
    }

    if (trimmed.startsWith("# ")) {
      elements.push(
        <h1 key={`h1-${i}`} className="mb-1 mt-5 text-[19px] font-bold text-white">
          {renderInline(trimmed.slice(2))}
        </h1>
      )
      continue
    }

    // ── Unordered list ───────────────────────────────────────────────────
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const items: string[] = [trimmed.slice(2)]
      let j = i + 1
      while (
        j < lines.length &&
        (lines[j].trim().startsWith("- ") || lines[j].trim().startsWith("* "))
      ) {
        items.push(lines[j].trim().slice(2))
        j++
      }
      elements.push(
        <ul key={`ul-${i}`} className="mb-2 mt-1 list-disc pl-5 space-y-1">
          {items.map((item, k) => (
            <li key={k} className="text-[15px] leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      )
      i = j - 1
      continue
    }

    // ── Ordered list ─────────────────────────────────────────────────────
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [trimmed.replace(/^\d+\.\s/, "")]
      let j = i + 1
      while (j < lines.length && /^\d+\.\s/.test(lines[j].trim())) {
        items.push(lines[j].trim().replace(/^\d+\.\s/, ""))
        j++
      }
      elements.push(
        <ol key={`ol-${i}`} className="mb-2 mt-1 list-decimal pl-5 space-y-1">
          {items.map((item, k) => (
            <li key={k} className="text-[15px] leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      )
      i = j - 1
      continue
    }

    // ── Blockquote ───────────────────────────────────────────────────────
    if (trimmed.startsWith("> ")) {
      elements.push(
        <blockquote
          key={`bq-${i}`}
          className="mb-2 mt-1 border-l-2 border-white/20 pl-3 text-[14px] italic text-white/50"
        >
          {renderInline(trimmed.slice(2))}
        </blockquote>
      )
      continue
    }

    // ── Table ────────────────────────────────────────────────────────────
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const rows: string[][] = []
      let j = i
      while (
        j < lines.length &&
        lines[j].trim().startsWith("|") &&
        lines[j].trim().endsWith("|")
      ) {
        // skip separator rows like |---|---|
        if (!/^\|[\s|:-]+\|$/.test(lines[j].trim())) {
          rows.push(
            lines[j]
              .split("|")
              .filter(Boolean)
              .map((c) => c.trim())
          )
        }
        j++
      }
      if (rows.length >= 2) {
        const [header, ...body] = rows
        elements.push(
          <table key={`table-${i}`} className="mb-3 mt-2 w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                {header.map((h, k) => (
                  <th key={k} className="px-3 py-1.5 text-left font-medium text-white/50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, k) => (
                <tr key={k} className="border-b border-white/[0.06] last:border-0">
                  {row.map((cell, l) => (
                    <td key={l} className="px-3 py-1.5 text-white/80">
                      {cell}
                    </td>
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

    // ── Paragraph ────────────────────────────────────────────────────────
    elements.push(
      <p key={`p-${i}`} className="mb-2 text-[15px] leading-relaxed last:mb-0">
        {renderInline(line)}
      </p>
    )
  }

  return elements
}

// ── Inline parser (bold, italic, code, links) ─────────────────────────────
function renderInline(line: string): ReactNode {
  const parts: ReactNode[] = []
  let remaining = line
  let key = 0

  while (remaining.length > 0) {
    // Inline code  `code`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      parts.push(
        <span
          key={key++}
          className="inline-flex items-center rounded px-1.5 py-px text-[13px] font-mono"
          style={{
            background: "#1E1E1E",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#C8C8C8",
          }}
        >
          {codeMatch[1]}
        </span>
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Bold  **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {boldMatch[1]}
        </strong>
      )
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Italic  *text*  or  _text_
    const italicStarMatch = remaining.match(/^\*(?!\*)(.+?)\*(?!\*)/)
    if (italicStarMatch) {
      parts.push(<em key={key++}>{italicStarMatch[1]}</em>)
      remaining = remaining.slice(italicStarMatch[0].length)
      continue
    }
    const italicUnderMatch = remaining.match(/^_(.+?)_/)
    if (italicUnderMatch) {
      parts.push(<em key={key++}>{italicUnderMatch[1]}</em>)
      remaining = remaining.slice(italicUnderMatch[0].length)
      continue
    }

    // Link  [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      parts.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-400 hover:underline"
        >
          {linkMatch[1]}
        </a>
      )
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // Plain character
    parts.push(remaining[0])
    remaining = remaining.slice(1)
  }

  return parts
}

// ── Syntax highlighting ────────────────────────────────────────────────────
const KEYWORD_MAP: Record<string, string[]> = {
  bash: ["if","then","else","fi","for","while","do","done","in","function","return","local","export","source","echo","exit","cd","mkdir","rm","cp","mv","touch","cat","grep","sed","awk","npm","npx","yarn","pnpm","node","python","pip","docker","git","curl","wget"],
  sh: ["if","then","else","fi","for","while","do","done","in","function","return","local","export","source","echo","exit","cd","mkdir","rm","cp","mv","touch","cat","grep","sed","awk"],
  js: ["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","this","async","await","import","export","from","class","extends","try","catch","throw","typeof","instanceof","true","false","null","undefined","require","module"],
  ts: ["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","this","async","await","import","export","from","class","extends","interface","type","implements","try","catch","throw","typeof","instanceof","true","false","null","undefined","enum","readonly","public","private","protected","abstract","static"],
  tsx: ["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","this","async","await","import","export","from","class","extends","interface","type","implements","try","catch","throw","typeof","instanceof","true","false","null","undefined","enum","readonly","public","private","protected","abstract","static"],
  jsx: ["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","this","async","await","import","export","from","class","extends","try","catch","throw","typeof","instanceof","true","false","null","undefined","require","module"],
  python: ["def","class","return","if","elif","else","for","while","try","except","finally","with","as","import","from","async","await","True","False","None","in","is","not","and","or","pass","raise","yield","lambda","self","print","len","range","int","str","list","dict","set","tuple"],
  json: ["true","false","null"],
  html: ["html","head","body","div","span","p","a","img","ul","ol","li","table","tr","td","th","form","input","button","script","style","link","meta","title","h1","h2","h3","h4","h5","h6","section","article","nav","header","footer","main","aside","class","id","href","src","alt","rel","type"],
  css: ["@import","@media","@keyframes","color","background","margin","padding","border","display","flex","grid","position","top","left","right","bottom","width","height","font","text","transform","transition","animation","opacity","overflow","z-index","important"],
  sql: ["SELECT","FROM","WHERE","INSERT","INTO","VALUES","UPDATE","SET","DELETE","CREATE","TABLE","ALTER","DROP","INDEX","JOIN","LEFT","RIGHT","INNER","OUTER","ON","AND","OR","NOT","IN","LIKE","BETWEEN","ORDER","BY","GROUP","HAVING","LIMIT","OFFSET","AS","DISTINCT","COUNT","SUM","AVG","MAX","MIN","NULL","IS","EXISTS","UNION","ALL","CASE","WHEN","THEN","ELSE","END"],
}

function highlightLine(line: string, lang: string): ReactNode[] {
  const keywords = KEYWORD_MAP[lang] ?? []
  if (keywords.length === 0) return [line]

  const parts: ReactNode[] = []
  const tokenRegex =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#.*$|[a-zA-Z_$][\w$]*|[^\s\w]+|\s+)/g
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

// ── Code block component ───────────────────────────────────────────────────
function CodeBlock({ content, lang }: { content: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const lines = content.split("\n")

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const normalizedLang = lang?.toLowerCase() ?? ""

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/[0.08]">
      {/* Header — flush, no gap */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: "#1A1A1A", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <span className="text-[11px] font-medium uppercase tracking-widest text-white/30">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-white/30 transition-colors hover:text-white/60"
        >
          {copied ? (
            <span className="text-[11px] text-teal-400">Copied</span>
          ) : (
            <>
              <Copy size={11} />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Body — same bg, no visual gap */}
      <pre
        className="overflow-x-auto p-3 text-[13.5px] font-mono leading-relaxed"
        style={{ background: "#141414", margin: 0, scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <code>
          {normalizedLang && KEYWORD_MAP[normalizedLang]
            ? lines.map((line, i) => (
                <span key={i}>
                  {highlightLine(line, normalizedLang)}
                  {i < lines.length - 1 && "\n"}
                </span>
              ))
            : content}
        </code>
      </pre>
    </div>
  )
}