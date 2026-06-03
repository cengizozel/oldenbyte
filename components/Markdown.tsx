import type { ReactNode } from "react";

// Minimal Markdown renderer for chat replies — covers the subset models emit:
// headings, bold/italic, inline code, fenced code blocks, ordered/unordered
// lists, blockquotes, links, and paragraphs. Not a full CommonMark parser, but
// enough to make replies readable. Partial/unclosed markup (during streaming)
// just renders as literal text until it's completed.

// Inline: `code`, **bold**, *italic*, [text](url). Underscore emphasis is
// intentionally omitted so snake_case and URLs aren't mangled.
function renderInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0, i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${prefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(<code key={key} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold">{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key} className="italic">{tok.slice(1, -1)}</em>);
    } else {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      nodes.push(<a key={key} href={mm[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-words hover:opacity-80">{mm[1]}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const isHeading = (l: string) => /^#{1,6}\s/.test(l);
const isQuote = (l: string) => /^>\s?/.test(l);
const isUl = (l: string) => /^\s*[-*+]\s+/.test(l);
const isOl = (l: string) => /^\s*\d+\.\s+/.test(l);

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0, k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push(
        <pre key={k++} className="my-1.5 p-2 rounded-lg bg-black/10 dark:bg-white/10 overflow-x-auto text-[12px] font-mono leading-relaxed">
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (line.trim() === "") { i++; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const hk = k++;
      const level = h[1].length;
      const cls = level <= 1 ? "text-base font-semibold" : level === 2 ? "text-[15px] font-semibold" : "text-sm font-semibold";
      out.push(<p key={hk} className={`${cls} mt-2 first:mt-0 mb-0.5`}>{renderInline(h[2], `h${hk}`)}</p>);
      i++;
      continue;
    }

    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(<blockquote key={k++} className="my-1.5 pl-3 border-l-2 border-black/15 dark:border-white/20 opacity-80">{parseBlocks(buf.join("\n"))}</blockquote>);
      continue;
    }

    if (isUl(line)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out.push(<ul key={k} className="my-1 ml-4 list-disc space-y-0.5">{items.map((it, j) => <li key={j}>{renderInline(it, `u${k}-${j}`)}</li>)}</ul>);
      k++;
      continue;
    }

    if (isOl(line)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push(<ol key={k} className="my-1 ml-4 list-decimal space-y-0.5">{items.map((it, j) => <li key={j}>{renderInline(it, `o${k}-${j}`)}</li>)}</ol>);
      k++;
      continue;
    }

    // Paragraph — collect until a blank line or a block starter.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" &&
           !/^```/.test(lines[i].trim()) && !isHeading(lines[i]) &&
           !isQuote(lines[i]) && !isUl(lines[i]) && !isOl(lines[i])) {
      buf.push(lines[i]); i++;
    }
    const pk = k++;
    const inner: ReactNode[] = [];
    buf.forEach((ln, j) => {
      if (j > 0) inner.push(<br key={`b${j}`} />);
      inner.push(...renderInline(ln, `p${pk}-${j}`));
    });
    out.push(<p key={pk} className="my-1 first:mt-0 last:mb-0 leading-relaxed">{inner}</p>);
  }

  return out;
}

export default function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return <div className={className}>{parseBlocks(text)}</div>;
}
