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

// Full-text search a space (or all spaces when spaceId is empty), newest first.
export async function anytypeSearch(
  baseUrl: string, apiKey: string, spaceId: string, query: string, limit: number, signal?: AbortSignal,
): Promise<AnytypeHit[]> {
  const url = spaceId
    ? `${root(baseUrl)}/v1/spaces/${encodeURIComponent(spaceId)}/search?limit=${limit}`
    : `${root(baseUrl)}/v1/search?limit=${limit}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ query, sort: { property_key: "last_modified_date", direction: "desc" } }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((o: any) => !o.archived)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((o: any) => {
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
    });
}

// Read an object's full body as markdown (the ?format=md ObjectWithBody view).
export async function anytypeReadObject(
  baseUrl: string, apiKey: string, spaceId: string, objectId: string, signal?: AbortSignal,
): Promise<{ name: string; markdown: string; type: string; created: string; modified: string; fields: { name: string; value: string }[] }> {
  const res = await fetch(
    `${root(baseUrl)}/v1/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}?format=md`,
    { headers: headers(apiKey), signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const o = data.object ?? data;
  const meta = extractMeta(o.properties);
  return { name: o.name || "(untitled)", markdown: o.markdown || "", type: o.type?.name || "", ...meta };
}

// Deep link that opens an object in the Anytype desktop app.
export function anytypeDeepLink(spaceId: string, objectId: string): string {
  return `anytype://object?objectId=${encodeURIComponent(objectId)}&spaceId=${encodeURIComponent(spaceId)}`;
}
