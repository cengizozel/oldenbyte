import { NextRequest, NextResponse } from "next/server";

// Proxy to the Anytype local API (embedded in the Anytype desktop app, default
// http://127.0.0.1:31009). Server-side, like /api/kiwix and /api/model, to dodge
// CORS/mixed-content. The desktop app must be running and reachable from wherever
// the dashboard server runs (same machine, or tunneled — Anytype binds localhost).
//
// Auth is a one-time pairing: POST /v1/auth/challenges → Anytype shows a 4-digit
// code → POST /v1/auth/api_keys {challenge_id, code} → api_key (a Bearer token).
// Reads (spaces, search) carry that token.

const ANYTYPE_VERSION = "2025-11-08";

function root(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function headers(apiKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Anytype-Version": ANYTYPE_VERSION,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function errMsg(res: Response): Promise<string> {
  try {
    const e = await res.json();
    return e.error?.message ?? e.message ?? e.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// GET reads: ?op=spaces | ?op=search&q=&spaceId=&limit=
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const baseUrl = sp.get("baseUrl");
  const apiKey = sp.get("apiKey") ?? "";
  const op = sp.get("op");
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json({ error: "Missing or invalid baseUrl" }, { status: 400 });
  }
  try {
    if (op === "spaces") {
      const res = await fetch(`${root(baseUrl)}/v1/spaces?limit=100`, { headers: headers(apiKey), signal: request.signal });
      if (!res.ok) throw new Error(await errMsg(res));
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spaces = (data.data ?? []).map((s: any) => ({ id: s.id, name: s.name || "(untitled space)" }));
      return NextResponse.json({ spaces });
    }
    if (op === "search") {
      const q = sp.get("q") ?? "";
      const spaceId = sp.get("spaceId") ?? "";
      const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 25)));
      // Per-space search when a space is chosen; otherwise across all spaces.
      const url = spaceId
        ? `${root(baseUrl)}/v1/spaces/${encodeURIComponent(spaceId)}/search?limit=${limit}`
        : `${root(baseUrl)}/v1/search?limit=${limit}`;
      const res = await fetch(url, {
        method: "POST",
        headers: headers(apiKey),
        // Empty query + sort by recency gives a "recent objects" list.
        body: JSON.stringify({ query: q, sort: { property_key: "last_modified_date", direction: "desc" } }),
        signal: request.signal,
      });
      if (!res.ok) throw new Error(await errMsg(res));
      const data = await res.json();
      const objects = (data.data ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((o: any) => !o.archived)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((o: any) => ({
          id: o.id,
          name: o.name || "(untitled)",
          snippet: o.snippet || "",
          spaceId: o.space_id,
          type: o.type?.name || o.type?.key || "",
        }));
      return NextResponse.json({ objects });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}

// POST auth: {op:"challenge", baseUrl} → {challengeId}
//            {op:"key", baseUrl, challengeId, code} → {apiKey}
export async function POST(request: NextRequest) {
  const { op, baseUrl, challengeId, code } = await request.json();
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json({ error: "Missing or invalid baseUrl" }, { status: 400 });
  }
  try {
    if (op === "challenge") {
      const res = await fetch(`${root(baseUrl)}/v1/auth/challenges`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ app_name: "oldenbyte" }),
        signal: request.signal,
      });
      if (!res.ok) throw new Error(await errMsg(res));
      const data = await res.json();
      return NextResponse.json({ challengeId: data.challenge_id });
    }
    if (op === "key") {
      if (!challengeId || !code) {
        return NextResponse.json({ error: "Missing challengeId or code" }, { status: 400 });
      }
      const res = await fetch(`${root(baseUrl)}/v1/auth/api_keys`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ challenge_id: challengeId, code: String(code) }),
        signal: request.signal,
      });
      if (!res.ok) throw new Error(await errMsg(res));
      const data = await res.json();
      return NextResponse.json({ apiKey: data.api_key });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
