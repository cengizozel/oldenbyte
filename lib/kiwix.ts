// Core Kiwix (kiwix-serve) access — fetching + XML parsing — shared by the
// /api/kiwix route and the Chat route's agentic tool loop. Keeping it here lets
// the Chat route call it directly instead of fetching its own /api/kiwix over
// HTTP, which the auth middleware would redirect to /login (the server-side
// request carries no session cookie).
//
// A "source" is a ZIM (Wikipedia, WikiHow, …); its `id` is the content-route
// name kiwix uses internally (the `content=` param).

export type KiwixSource = { title: string; id: string };
export type KiwixResult = { title: string; url: string; snippet: string };

// kiwix-serve is rooted at the host, e.g. http://host:3702 — strip trailing /
export function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function isValidBase(b: string | null | undefined): b is string {
  return Boolean(b && /^https?:\/\//.test(b));
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

// List the sources (ZIMs) from the OPDS catalog.
export async function listSources(baseUrl: string, signal?: AbortSignal): Promise<KiwixSource[]> {
  const base = normalizeBase(baseUrl);
  const res = await fetch(`${base}/catalog/v2/entries`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return blocks(xml, "entry")
    .map((entry) => {
      const title = tagText(entry, "title");
      // The content route name is the last path segment of the html link,
      // e.g. href="/content/wikipedia_en_all_maxi_2024-01" → that segment.
      const href = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]+)"/)?.[1] ?? "";
      const id = href.split("/").filter(Boolean).pop() ?? "";
      return { title, id };
    })
    .filter((s) => s.id);
}

// Full-text search within one source. `limit` is clamped to 1–20.
export async function search(
  baseUrl: string,
  source: string,
  query: string,
  limit = 8,
  signal?: AbortSignal
): Promise<KiwixResult[]> {
  const base = normalizeBase(baseUrl);
  const params = new URLSearchParams({
    content: source,
    pattern: query,
    format: "xml",
    pageLength: String(Math.min(Math.max(limit, 1), 20)),
  });
  const res = await fetch(`${base}/search?${params}`, { signal });
  if (!res.ok) {
    // kiwix returns 500 + an HTML/XML error body when a ZIM can't be read.
    throw new Error(`Search failed (HTTP ${res.status}) — is the source available on the server?`);
  }
  const xml = await res.text();
  return blocks(xml, "item").map((item) => {
    const link = tagText(item, "link"); // e.g. /content/<source>/A/Article
    return {
      title: cleanField(tagText(item, "title")),
      url: link.startsWith("http") ? link : `${base}${link.startsWith("/") ? "" : "/"}${link}`,
      snippet: cleanField(tagText(item, "description")),
    };
  });
}

// Fetch an article and extract a readable plain-text lead (~1400 chars).
export async function articleExtract(
  baseUrl: string,
  articleUrl: string,
  signal?: AbortSignal
): Promise<string> {
  const base = normalizeBase(baseUrl);
  // Only allow fetching from the same kiwix host the user configured.
  if (!articleUrl.startsWith(base)) throw new Error("Article URL outside the configured server");
  const res = await fetch(articleUrl, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let html = await res.text();
  // Drop <style>/<script> blocks first — otherwise their CSS/JS *text* survives
  // tag-stripping and leaks into the extract (Wikipedia inlines <style> rules
  // inside the lead paragraph).
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
  return extract.trim();
}
