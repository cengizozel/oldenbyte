// Citation normalization for LLM-generated digest prose.
//
// The digest renderer turns [N] markers into clickable reference links.
// Hosted models follow the bracket format reliably; local models drift into
// every imaginable variant: (1), 【1】, [ 1 ], [^1], [1, 2], [1-3], markdown
// links, echoed REFERENCES blocks, leaked <think> reasoning. Rather than
// fighting that with prompting alone, this pass canonicalizes model output
// before render. It is idempotent, so it can run on cached summaries and on
// partial streaming text.

export type CitationRef = { n: number; title: string; link: string };

// Strip <think>/<thinking> reasoning blocks (paired anywhere, or an unclosed
// opener that swallows the rest, or a stray close tag with a missing opener,
// which some runtimes emit when the opener is consumed upstream).
export function stripThinking(raw: string): string {
  let text = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  text = text.replace(/<think(?:ing)?>[\s\S]*$/gi, "");
  const close = text.match(/<\/think(?:ing)?>/i);
  if (close) text = text.slice(text.indexOf(close[0]) + close[0].length);
  return text;
}

export function normalizeCitations(raw: string, refs: CitationRef[]): string {
  if (!raw) return raw;
  const maxN = refs.length ? Math.max(...refs.map(r => r.n)) : 0;
  let text = stripThinking(raw);

  // Echoed REFERENCES block: a header line followed by numbered title lines.
  const refBlock = /(?:^|\n)\s*(?:\*\*|#+\s*)?references:?(?:\*\*)?\s*\n(?:\s*\[?\d+\]?[.:)]?\s+.*(?:\n|$))+/gi;
  text = text.replace(refBlock, "\n");
  // Stray reference lines the model appends without a header.
  text = text.replace(/\n\s*\[\d+\]\s+["“][^\n]*$/g, "");

  // Markdown links: map to a reference when the URL or label matches one,
  // otherwise keep just the label text (never render raw markdown).
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
    const hit =
      refs.find(r => r.link === url) ??
      refs.find(r => r.title.toLowerCase() === label.trim().toLowerCase());
    if (!hit) return label;
    return /^\d+$/.test(label.trim()) ? `[${hit.n}]` : `${label} [${hit.n}]`;
  });

  // Variant brackets to canonical [N].
  text = text.replace(/\*\*\[(\d+)\]\*\*/g, "[$1]");          // **[1]**
  text = text.replace(/\[\^(\d+)\]/g, "[$1]");                 // [^1]
  text = text.replace(/【\s*(\d+)\s*】/g, "[$1]");             // 【1】
  text = text.replace(/\[\s+(\d+)\s*\]|\[\s*(\d+)\s+\]/g, (_m, a, b) => `[${a ?? b}]`); // [ 1 ]
  text = text.replace(/\[\s*(?:source|ref(?:erence)?)\s*[:#]?\s*(\d+)\s*\]/gi, "[$1]"); // [source 3]

  // Multi-citations: [1, 2] and [1-3] expand to [1][2](...).
  text = text.replace(/\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*[,;]\s*\d+(?:\s*[-–]\s*\d+)?)+|\d+\s*[-–]\s*\d+)\]/g, (m, inner: string) => {
    const ns: number[] = [];
    for (const part of inner.split(/[,;]/).map(s => s.trim())) {
      const range = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range) {
        const a = +range[1], b = +range[2];
        if (b < a || b - a > 10) return m;
        for (let i = a; i <= b; i++) ns.push(i);
      } else if (/^\d+$/.test(part)) {
        ns.push(+part);
      } else {
        return m;
      }
    }
    return ns.map(n => `[${n}]`).join("");
  });

  // Doubled brackets [[1]].
  text = text.replace(/\[+\[(\d+)\]\]+/g, "[$1]");

  // Parenthesized or braced single citations, only for in-range numbers so
  // ordinary parentheticals like "(2026)" survive.
  text = text.replace(/[({]\s*(\d+)\s*[)}]/g, (m, d: string) => {
    const n = +d;
    return n >= 1 && n <= maxN ? `[${n}]` : m;
  });

  // Finally: drop out-of-range markers entirely (a dead [99] is worse than
  // no marker), and tidy whitespace left behind by removals.
  text = text.replace(/\[(\d+)\]/g, (m, d: string) => {
    const n = +d;
    return n >= 1 && n <= maxN ? m : "";
  });
  text = text.replace(/[^\S\n]{2,}/g, " ").replace(/[^\S\n]+([.,;:!?])/g, "$1");

  return text.trim();
}
