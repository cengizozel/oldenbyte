import { NextRequest, NextResponse } from "next/server";

// Server-side proxy to a kiwix-serve instance (https://github.com/kiwix/kiwix-tools).
// Running it server-side avoids CORS and mixed-content blocking when the dashboard
// is served over HTTPS but kiwix-serve runs on plain http on the LAN/Tailnet.
//
// kiwix-serve only speaks XML for its full-text search, so we parse it here and
// hand the client clean JSON. A "source" is a ZIM (Wikipedia, WikiHow, …); its
// `id` is the content-route name kiwix uses internally (the `content=` param).
// Modes:
//   GET ?baseUrl=…                          → list sources (ZIMs) from the catalog
//   GET ?baseUrl=…&source=…&q=…&limit=N     → full-text search within one source
//   GET ?baseUrl=…&article=<url>            → fetch + extract one article's text

function normalizeBase(baseUrl: string): string {
  // kiwix-serve is rooted at the host, e.g. http://host:3702 — strip trailing /
  return baseUrl.trim().replace(/\/+$/, "");
}

function decodeEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" doesn't double-decode
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) ?? [];
}

function tagText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]).trim() : "";
}

// Clean a kiwix search field (title/snippet). Kiwix double-encodes its <b>/<i>
// highlight markup — it HTML-escapes the tags and the XML escapes them again —
// so a single decode leaves literal "&lt;i&gt;". Decode a second time, strip the
// tags that re-emerge, and drop [3]-style citation markers.
function cleanField(s: string): string {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, "")
    .replace(/\[(?:note\s*)?\d+\]/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidBase(b: string | null): b is string {
  return Boolean(b && /^https?:\/\//.test(b));
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const baseUrl = p.get("baseUrl");
  if (!isValidBase(baseUrl)) {
    return NextResponse.json({ error: "Missing or invalid baseUrl" }, { status: 400 });
  }
  const base = normalizeBase(baseUrl);
  const q = p.get("q");

  // ── Fetch an article and extract a readable text summary ────────────────────
  const article = p.get("article");
  if (article) {
    // Only allow fetching from the same kiwix host the user configured.
    if (!article.startsWith(base)) {
      return NextResponse.json({ error: "Article URL outside the configured server" }, { status: 400 });
    }
    try {
      const res = await fetch(article, { signal: request.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let html = await res.text();
      // Drop <style>/<script> blocks first — otherwise their CSS/JS *text*
      // survives tag-stripping and leaks into the extract (Wikipedia inlines
      // <style> rules inside the lead paragraph).
      html = html.replace(/<(style|script)[\s>][\s\S]*?<\/\1>/gi, "");
      // Narrow to the main wiki content when present, so we skip nav/sidebars.
      const main = html.match(/id="mw-content-text"[\s\S]*/);
      if (main) html = main[0];
      const paras = (html.match(/<p[\s>][\s\S]*?<\/p>/g) ?? [])
        .map((para) =>
          decodeEntities(para.replace(/<[^>]+>/g, ""))
            .replace(/\[(?:note\s*)?\d+\]/gi, "") // drop [1] / [note 1] citation markers
            .replace(/\s*ⓘ\s*/g, " ") // audio-pronunciation glyph
            .replace(/\s+([,.;:])/g, "$1") // tidy spacing left by removals
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter((t) => t.length > 40);
      let extract = "";
      for (const para of paras) {
        extract += para + "\n\n";
        if (extract.length > 1400) break;
      }
      return NextResponse.json({ extract: extract.trim() });
    } catch (err) {
      return NextResponse.json({ error: `Could not load article: ${String(err)}` }, { status: 502 });
    }
  }

  // ── List sources ────────────────────────────────────────────────────────────
  if (!q) {
    try {
      const res = await fetch(`${base}/catalog/v2/entries`, { signal: request.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const sources = blocks(xml, "entry")
        .map((entry) => {
          const title = tagText(entry, "title");
          // The content route name is the last path segment of the html link,
          // e.g. href="/content/wikipedia_en_all_maxi_2024-01" → that segment.
          const href = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]+)"/)?.[1] ?? "";
          const id = href.split("/").filter(Boolean).pop() ?? "";
          return { title, id };
        })
        .filter((s) => s.id);
      return NextResponse.json({ sources });
    } catch (err) {
      return NextResponse.json({ error: `Could not list sources: ${String(err)}` }, { status: 502 });
    }
  }

  // ── Search within a source ──────────────────────────────────────────────────
  const source = p.get("source");
  if (!source) {
    return NextResponse.json({ error: "Missing source" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(p.get("limit")) || 8, 1), 20);
  const params = new URLSearchParams({
    content: source,
    pattern: q,
    format: "xml",
    pageLength: String(limit),
  });

  try {
    const res = await fetch(`${base}/search?${params}`, { signal: request.signal });
    if (!res.ok) {
      // kiwix returns 500 + an HTML/XML error body when a ZIM can't be read.
      return NextResponse.json(
        { error: `Search failed (HTTP ${res.status}) — is the source available on the server?` },
        { status: 502 }
      );
    }
    const xml = await res.text();
    const results = blocks(xml, "item").map((item) => {
      const link = tagText(item, "link"); // e.g. /content/<source>/A/Article
      return {
        title: cleanField(tagText(item, "title")),
        url: link.startsWith("http") ? link : `${base}${link.startsWith("/") ? "" : "/"}${link}`,
        snippet: cleanField(tagText(item, "description")),
      };
    });
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: `Could not reach kiwix: ${String(err)}` }, { status: 502 });
  }
}
