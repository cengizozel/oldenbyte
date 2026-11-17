// Totals from a DNS blocker for the DNS widget: AdGuard Home or Pi-hole
// (v6's session API, falling back to v5's api.php).

export type DnsStats = {
  queries: number;
  blocked: number;
  percent: number;          // share of queries blocked, 0 to 100
  avgMs: number | null;     // AdGuard: average time to answer
  blocklist: number | null; // Pi-hole: domains on the blocklists
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const base = (url: string) => url.replace(/\/+$/, "");
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Each product's JSON to DnsStats. Exported for tests.
export function fromAdGuard(d: Record<string, unknown>): DnsStats {
  const queries = num(d.num_dns_queries), blocked = num(d.num_blocked_filtering);
  return { queries, blocked, percent: queries ? (blocked / queries) * 100 : 0, avgMs: d.avg_processing_time != null ? num(d.avg_processing_time) * 1000 : null, blocklist: null };
}
export function fromPiholeV6(d: Record<string, unknown>): DnsStats {
  const q = (d.queries ?? {}) as Record<string, unknown>, g = (d.gravity ?? {}) as Record<string, unknown>;
  return { queries: num(q.total), blocked: num(q.blocked), percent: num(q.percent_blocked), avgMs: null, blocklist: g.domains_being_blocked != null ? num(g.domains_being_blocked) : null };
}
export function fromPiholeV5(d: Record<string, unknown>): DnsStats {
  return { queries: num(d.dns_queries_today), blocked: num(d.ads_blocked_today), percent: num(d.ads_percentage_today), avgMs: null, blocklist: d.domains_being_blocked != null ? num(d.domains_being_blocked) : null };
}

export async function adguardStats(fetcher: Fetcher, url: string, username: string, password: string): Promise<DnsStats> {
  const res = await fetcher(`${base(url)}/control/stats`, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("AdGuard Home refused the username or password.");
  if (!res.ok) throw new Error(`AdGuard Home answered HTTP ${res.status}.`);
  return fromAdGuard(await res.json());
}

// Pi-hole v6 hands out a limited number of sessions, so one is kept per
// server and reused until it is refused.
const sessions = new Map<string, string>();

async function piholeV6(fetcher: Fetcher, url: string, password: string): Promise<DnsStats | null> {
  const key = `${base(url)}|${password}`;
  const summary = async (sid: string) => fetcher(`${base(url)}/api/stats/summary`, { headers: { "X-FTL-SID": sid }, signal: AbortSignal.timeout(8000) });
  let sid = sessions.get(key);
  if (sid) {
    const res = await summary(sid);
    if (res.ok) return fromPiholeV6(await res.json());
    sessions.delete(key);
  }
  const auth = await fetcher(`${base(url)}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(8000),
  });
  if (auth.status === 404) return null;   // not a v6 server
  if (auth.status === 401) throw new Error("Pi-hole refused the password.");
  if (auth.status === 429) throw new Error("Pi-hole has no free sessions. Wait a few minutes, or remove old sessions in its settings.");
  if (!auth.ok) throw new Error(`Pi-hole answered HTTP ${auth.status}.`);
  const data = await auth.json().catch(() => null);
  sid = data?.session?.sid;
  // A server with no password set answers valid without a session id.
  if (!sid && !data?.session?.valid) throw new Error("Pi-hole refused the password.");
  const res = await summary(sid ?? "");
  if (!res.ok) throw new Error(`Pi-hole answered HTTP ${res.status}.`);
  if (sid) sessions.set(key, sid);
  return fromPiholeV6(await res.json());
}

export async function piholeStats(fetcher: Fetcher, url: string, password: string): Promise<DnsStats> {
  const v6 = await piholeV6(fetcher, url, password);
  if (v6) return v6;
  // Version 5: the password field holds the API token from its settings.
  const res = await fetcher(`${base(url)}/admin/api.php?summaryRaw&auth=${encodeURIComponent(password)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Pi-hole answered HTTP ${res.status}.`);
  const data = await res.json().catch(() => null);
  if (!data || Array.isArray(data) || data.dns_queries_today == null) throw new Error("Pi-hole refused the API token.");
  return fromPiholeV5(data);
}
