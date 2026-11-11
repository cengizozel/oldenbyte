import { userFetch } from "@/lib/requestUser";
// Shared server-side Anytype API helpers, used by both /api/anytype (the widget)
// and /api/chat (the agentic lookup). Kept in lib/ — like lib/kiwix — so the chat
// route can call Anytype directly; a server-side fetch to /api/anytype carries no
// session cookie and the auth middleware would redirect it to the login page.

export const ANYTYPE_VERSION = "2025-11-08";

function root(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Anytype-Version": ANYTYPE_VERSION,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export type AnytypeHit = { id: string; name: string; snippet: string; type: string; spaceId: string; created: string; modified: string };

// Pull a scalar display value out of a typed PropertyWithValue (text/number/
// date/checkbox/url/…); returns null for empty or non-scalar values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function propValue(p: any): string | null {
  if (p.text) return String(p.text);
  if (p.number != null) return String(p.number);
  if (p.date) return String(p.date);
  if (typeof p.checkbox === "boolean") return p.checkbox ? "yes" : "no";
  if (p.url) return String(p.url);
  if (p.email) return String(p.email);
  if (p.phone) return String(p.phone);
  if (p.select?.name) return String(p.select.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray(p.multi_select)) return p.multi_select.map((t: any) => t?.name).filter(Boolean).join(", ") || null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray(p.objects)) return p.objects.map((o: any) => o?.name).filter(Boolean).join(", ") || null;
  return null;
}

// Anytype keeps dates and custom fields in the object's `properties` array.
// Split out the two system dates and collect the rest as readable name/value pairs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMeta(properties: any[]): { created: string; modified: string; fields: { name: string; value: string }[] } {
  const props = Array.isArray(properties) ? properties : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byKey = (k: string) => props.find((p: any) => p.key === k);
  const created = byKey("created_date")?.date || "";
  const modified = byKey("last_modified_date")?.date || "";
  const fields = props
    .filter((p) => p.key !== "created_date" && p.key !== "last_modified_date")
    .map((p) => ({ name: p.name || p.key, value: propValue(p) }))
    .filter((p): p is { name: string; value: string } => Boolean(p.value));
  return { created, modified, fields };
}

// One raw search request. Anytype matches the query as a contiguous phrase, so
// multi-word queries only hit when those words appear adjacent. An optional
// type key narrows results to objects of that type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rawSearch(baseUrl: string, apiKey: string, spaceId: string, query: string, limit: number, signal?: AbortSignal, typeKey?: string): Promise<any[]> {
  const url = spaceId
    ? `${root(baseUrl)}/v1/spaces/${encodeURIComponent(spaceId)}/search?limit=${limit}`
    : `${root(baseUrl)}/v1/search?limit=${limit}`;
  const res = await userFetch(url, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      query,
      ...(typeKey ? { types: [typeKey] } : {}),
      sort: { property_key: "last_modified_date", direction: "desc" },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.data ?? []).filter((o: any) => !o.archived);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toHit(o: any): AnytypeHit {
  const meta = extractMeta(o.properties);
  return {
    id: o.id,
    name: o.name || "(untitled)",
    snippet: o.snippet || "",
    type: o.type?.name || o.type?.key || "",
    spaceId: o.space_id,
    created: meta.created,
    modified: meta.modified,
  };
}

// Full-text search a space (or all spaces when spaceId is empty), newest first.
// Because Anytype matches the whole query as a phrase, a multi-word query that
// finds nothing is retried as an AND of its terms — search each word and keep the
// objects that match every one — so "2026 journal" still finds "Journal (2026)".
export async function anytypeSearch(
  baseUrl: string, apiKey: string, spaceId: string, query: string, limit: number, signal?: AbortSignal, typeKey?: string,
): Promise<AnytypeHit[]> {
  const direct = await rawSearch(baseUrl, apiKey, spaceId, query, limit, signal, typeKey);
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (direct.length > 0 || terms.length < 2) return direct.map(toHit);

  const perTerm = await Promise.all(
    terms.map((t) => rawSearch(baseUrl, apiKey, spaceId, t, Math.max(limit, 50), signal, typeKey)),
  );
  const idSets = perTerm.map((arr) => new Set(arr.map((o) => o.id)));
  // Keep objects present in every term's results, ordered by the first term's ranking.
  const merged = perTerm[0].filter((o) => idSets.every((s) => s.has(o.id)));
  return merged.slice(0, limit).map(toHit);
}

// emoji: the type's emoji icon; icon: the name of its built-in icon (Anytype
// uses Ionicons names such as "musical-notes"), when it has no emoji.
export type AnytypeType = { id: string; key: string; name: string; emoji?: string; icon?: string; count?: number };

// The object types defined in a space (Page, Note, Task, …), for browsing by type.
export async function anytypeTypes(
  baseUrl: string, apiKey: string, spaceId: string, signal?: AbortSignal,
): Promise<AnytypeType[]> {
  const res = await userFetch(
    `${root(baseUrl)}/v1/spaces/${encodeURIComponent(spaceId)}/types?limit=100`,
    { headers: headers(apiKey), signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((t: any) => !t.archived)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => ({ id: t.id, key: t.key, name: t.name || t.key, emoji: t.icon?.format === "emoji" && typeof t.icon.emoji === "string" ? t.icon.emoji : "", icon: t.icon?.format === "icon" && typeof t.icon.name === "string" ? t.icon.name : "" }))
    .sort((a: AnytypeType, b: AnytypeType) => a.name.localeCompare(b.name));
}

// How many objects each type has: a one-result search per type, reading the
// total the API reports. A few at a time; a type whose count fails is left
// without one.
export async function anytypeTypeCounts(
  baseUrl: string, apiKey: string, spaceId: string, types: AnytypeType[], signal?: AbortSignal,
): Promise<AnytypeType[]> {
  const out = [...types];
  let next = 0;
  async function worker() {
    while (next < out.length) {
      const i = next++;
      try {
        const res = await userFetch(`${root(baseUrl)}/v1/spaces/${encodeURIComponent(spaceId)}/search?limit=1`, {
          method: "POST", headers: headers(apiKey), signal,
          body: JSON.stringify({ query: "", types: [out[i].key] }),
        });
        if (!res.ok) continue;
        const total = (await res.json())?.pagination?.total;
        if (typeof total === "number") out[i] = { ...out[i], count: total };
      } catch { /* leave this one without a count */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, out.length) }, worker));
  return out;
}

// Read an object's full body as markdown (the ?format=md ObjectWithBody view).
export async function anytypeReadObject(
  baseUrl: string, apiKey: string, spaceId: string, objectId: string, signal?: AbortSignal,
): Promise<{ name: string; markdown: string; type: string; created: string; modified: string; fields: { name: string; value: string }[] }> {
  const res = await userFetch(
    `${root(baseUrl)}/v1/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}?format=md`,
    { headers: headers(apiKey), signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const o = data.object ?? data;
  const meta = extractMeta(o.properties);
  return { name: o.name || "(untitled)", markdown: o.markdown || "", type: o.type?.name || "", ...meta };
}

// An image in an object's body. The markdown export only names the file
// (![name](files/name.png)), so the file object is found by name, then fetched
// from the space's file gateway. The gateway reports a loopback address; it is
// read on the same host as the API (a desktop app reached over a tunnel has to
// expose the gateway port too, a headless client on a server usually does).
const gateways = new Map<string, string>();
const fileIds = new Map<string, string>();
const stem = (n: string) => n.replace(/^.*\//, "").replace(/\.[a-z0-9]{2,5}$/i, "").trim().toLowerCase();

export async function anytypeImage(
  baseUrl: string, apiKey: string, spaceId: string, name: string, signal?: AbortSignal,
): Promise<Response> {
  const api = root(baseUrl);
  const gwKey = `${api}|${spaceId}`;
  let gateway = gateways.get(gwKey);
  if (!gateway) {
    const res = await userFetch(`${api}/v1/spaces/${encodeURIComponent(spaceId)}`, { headers: headers(apiKey), signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw: string = (data.space ?? data).gateway_url ?? "";
    if (!raw) throw new Error("This Anytype space has no file gateway");
    const gw = new URL(raw);
    const apiHost = new URL(api).hostname;
    if (/^(127\.0\.0\.1|localhost|\[::1\])$/.test(gw.hostname)) gw.hostname = apiHost;
    gateway = gw.origin;
    gateways.set(gwKey, gateway);
  }
  const want = stem(name);
  const idKey = `${gwKey}|${want}`;
  let id = fileIds.get(idKey);
  if (!id) {
    const res = await userFetch(`${api}/v1/spaces/${encodeURIComponent(spaceId)}/search`, {
      method: "POST", headers: headers(apiKey), signal,
      body: JSON.stringify({ query: want.replace(/[-_]+/g, " "), limit: 25 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = (await res.json()).data ?? [];
    const images = rows.filter(o => o.layout === "image" || o.type?.key === "image");
    const hit = images.find(o => stem(o.name ?? "") === want) ?? images.find(o => stem(o.name ?? "").includes(want));
    if (!hit?.id) throw new Error("Image not found");
    id = hit.id as string;
    fileIds.set(idKey, id);
  }
  const img = await userFetch(`${gateway}/image/${encodeURIComponent(id)}?width=1200`, { signal });
  if (!img.ok) throw new Error(`gateway HTTP ${img.status}`);
  return img;
}

// Deep link that opens an object in the Anytype desktop app.
export function anytypeDeepLink(spaceId: string, objectId: string): string {
  return `anytype://object?objectId=${encodeURIComponent(objectId)}&spaceId=${encodeURIComponent(spaceId)}`;
}
