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

function parseResults(xml: string, base: string): KiwixResult[] {
  return blocks(xml, "item").map((item) => {
    const link = tagText(item, "link"); // e.g. /content/<source>/A/Article
    return {
      title: cleanField(tagText(item, "title")),
      url: link.startsWith("http") ? link : `${base}${link.startsWith("/") ? "" : "/"}${link}`,
      snippet: cleanField(tagText(item, "description")),
    };
  });
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
  return parseResults(xml, base);
}

// Search several books in ONE request via repeated books.name params.
// kiwix-serve merges and ranks server-side, but rejects sets that mix
// languages, so callers must group by language first.
async function searchBooks(
  base: string,
  bookIds: string[],
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<KiwixResult[]> {
  const params = new URLSearchParams({
    pattern: query,
    format: "xml",
    pageLength: String(Math.min(Math.max(limit, 1), 20)),
  });
  for (const id of bookIds) params.append("books.name", id);
  const res = await fetch(`${base}/search?${params}`, { signal });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  return parseResults(await res.text(), base);
}

// Language of a ZIM, inferred from its id ("wikipedia_en_all_maxi_2024-01" →
// "en"). Unknown layouts fall into their own group so a bad guess can only
// fail its own request.
function sourceLang(id: string): string {
  const m = id.match(/^[^_]+_([a-z]{2,3})(?:[_-]|$)/i);
  return m ? m[1].toLowerCase() : `solo:${id}`;
}

// Catalog cache so all-books search doesn't re-fetch OPDS on every tool call.
let catalogCache: { base: string; at: number; sources: KiwixSource[] } | null = null;
const CATALOG_TTL = 5 * 60 * 1000;

async function cachedSources(base: string, signal?: AbortSignal): Promise<KiwixSource[]> {
  if (catalogCache && catalogCache.base === base && Date.now() - catalogCache.at < CATALOG_TTL) {
    return catalogCache.sources;
  }
  const sources = await listSources(base, signal);
  catalogCache = { base, at: Date.now(), sources };
  return sources;
}

// Full-text search across EVERY book on the server: one request per language
// group, round-robin merged so a single huge book doesn't drown the others.
// Adding a ZIM to the server widens the searchable area with no config change.
export async function searchAllBooks(
  baseUrl: string,
  query: string,
  limit = 8,
  signal?: AbortSignal
): Promise<KiwixResult[]> {
  const base = normalizeBase(baseUrl);
  const sources = await cachedSources(base, signal);
  if (!sources.length) return [];

  const groups = new Map<string, KiwixSource[]>();
  for (const s of sources) {
    const lang = sourceLang(s.id);
    const g = groups.get(lang) ?? [];
    g.push(s);
    groups.set(lang, g);
  }

  const settled = await Promise.allSettled(
    [...groups.values()].map(g => searchBooks(base, g.map(s => s.id), query, limit, signal))
  );
  const lists = settled
    .filter((r): r is PromiseFulfilledResult<KiwixResult[]> => r.status === "fulfilled")
    .map(r => r.value)
    .filter(l => l.length);
  if (!lists.length) return [];

  const merged: KiwixResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; merged.length < limit; i++) {
    let any = false;
    for (const list of lists) {
      if (i >= list.length) continue;
      any = true;
      const r = list[i];
      if (!seen.has(r.url)) {
        seen.add(r.url);
        merged.push(r);
        if (merged.length >= limit) break;
      }
    }
    if (!any) break;
  }
  return merged;
}

// Strip tags (cells separated by spaces), decode, drop citation markers, tidy.
function cleanBlock(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\[(?:note\s*)?\d+\]/gi, "") // [1] / [note 1] citation markers
    .replace(/\s*ⓘ\s*/g, " ") // audio-pronunciation glyph
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Fetch an article and extract readable plain text: the lead paragraphs PLUS
// data-table rows. A lot of the factual specifics on a page (anything tabular —
// lists, stats, entries with dates) live in wikitables, often well below the
// intro, so paragraph-only extraction misses them. Capped so one article stays a
// reasonable chunk of context.
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

  const LEAD_CAP = 1500;
  const TOTAL_CAP = 6000;

  // Lead paragraphs.
  let lead = "";
  for (const p of html.match(/<p[\s>][\s\S]*?<\/p>/g) ?? []) {
    const t = cleanBlock(p);
    if (t.length <= 40) continue;
    lead += t + "\n\n";
    if (lead.length > LEAD_CAP) break;
  }

  // Data-table rows (wikitables: squads, rosters, lists, stats).
  let tables = "";
  const seen = new Set<string>();
  for (const tbl of html.match(/<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/gi) ?? []) {
    for (const row of tbl.match(/<tr[\s>][\s\S]*?<\/tr>/gi) ?? []) {
      const t = cleanBlock(row);
      if (t.length < 8 || seen.has(t)) continue;
      seen.add(t);
      tables += t + "\n";
      if (lead.length + tables.length > TOTAL_CAP) break;
    }
    if (lead.length + tables.length > TOTAL_CAP) break;
  }

  return [lead.trim(), tables.trim()].filter(Boolean).join("\n\n");
}
