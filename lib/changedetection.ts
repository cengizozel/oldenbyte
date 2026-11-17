// The watches of a changedetection.io server, for the Changes widget.
// Its API: GET /api/v1/watch with the x-api-key header (Settings > API).

export type Watch = {
  id: string;
  title: string;         // the watch's own title, else the page's, else its address
  url: string;           // the page being watched
  changedAt: number;     // seconds; 0 when it has never changed
  checkedAt: number;     // seconds; 0 when it has never been checked
  error: string;         // the last check's error, if any
  unseen: boolean;       // changed since you last looked at it there
  diff: string;          // where to see what changed
};

// changedetection.io's answer (an object keyed by watch id) to rows, newest
// change first. Exported for tests.
export function mapWatches(data: unknown, base: string): Watch[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const root = base.replace(/\/+$/, "");
  return Object.entries(data as Record<string, Record<string, unknown>>).map(([id, w]) => {
    const url = String(w?.url ?? "");
    const changedAt = Number(w?.last_changed) || 0;
    return {
      id,
      title: String(w?.title || w?.page_title || url.replace(/^https?:\/\//, "")),
      url,
      changedAt,
      checkedAt: Number(w?.last_checked) || 0,
      error: w?.last_error ? String(w.last_error) : "",
      unseen: w?.viewed === false && changedAt > 0,
      diff: `${root}/diff/${id}`,
    };
  }).sort((a, b) => b.changedAt - a.changedAt || a.title.localeCompare(b.title));
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function listWatches(fetcher: Fetcher, base: string, apiKey: string): Promise<Watch[]> {
  const res = await fetcher(`${base.replace(/\/+$/, "")}/api/v1/watch`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(8000) });
  if (res.status === 401 || res.status === 403) throw new Error("changedetection.io refused the API key.");
  if (!res.ok) throw new Error(`changedetection.io answered HTTP ${res.status}.`);
  return mapWatches(await res.json(), base);
}
