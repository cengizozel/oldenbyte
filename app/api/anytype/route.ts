import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { anytypeSearch, ANYTYPE_VERSION } from "@/lib/anytype";

// Proxy to the Anytype local API (embedded in the Anytype desktop app, default
// http://127.0.0.1:31009). Server-side, like /api/kiwix and /api/model, to dodge
// CORS/mixed-content. The desktop app must be running and reachable from wherever
// the dashboard server runs (same machine, or tunneled — Anytype binds localhost).
//
// Auth is a one-time pairing: POST /v1/auth/challenges → Anytype shows a 4-digit
// code → POST /v1/auth/api_keys {challenge_id, code} → api_key (a Bearer token).
// Reads (spaces, search) carry that token. Search/object reads live in lib/anytype
// so the chat route can reuse them directly.

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
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

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
      // Empty query + recency sort gives a "recent objects" list.
      const objects = await anytypeSearch(baseUrl, apiKey, spaceId, q, limit, request.signal);
      return NextResponse.json({ objects });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}

// POST auth: {op:"challenge", baseUrl} → {challengeId}
//            {op:"key", baseUrl, challengeId, code} → {apiKey}
// POST bridge (the write bridge, tools/anytype-bridge — credentials ride each
// request, same as auth):
//            {op:"bridge", bridgeUrl, bridgeToken, rpc:{op,...}} → bridge result
//            {op:"bridge-health", bridgeUrl} → {ok, app_version}
const BRIDGE_OPS = new Set(["list_types", "style_profile", "create_object", "append_markdown", "read_object", "search", "archive_object"]);

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const { op, baseUrl, challengeId, code, bridgeUrl, bridgeToken, rpc } = await request.json();

  if (op === "bridge" || op === "bridge-health") {
    if (!bridgeUrl || !/^https?:\/\//.test(bridgeUrl)) {
      return NextResponse.json({ error: "Missing or invalid bridgeUrl" }, { status: 400 });
    }
    const bridgeBase = root(bridgeUrl);
    try {
      if (op === "bridge-health") {
        const res = await fetch(`${bridgeBase}/health`, { signal: request.signal });
        return NextResponse.json(await res.json());
      }
      if (!rpc?.op || !BRIDGE_OPS.has(rpc.op)) {
        return NextResponse.json({ error: `Unknown bridge op "${rpc?.op ?? ""}"` }, { status: 400 });
      }
      const res = await fetch(`${bridgeBase}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridgeToken ?? ""}` },
        body: JSON.stringify(rpc),
        signal: request.signal,
      });
      const data = await res.json().catch(() => ({ error: `bridge HTTP ${res.status}` }));
      return NextResponse.json(data, { status: res.ok ? 200 : 502 });
    } catch (err) {
      return NextResponse.json({ error: `Bridge unreachable: ${String(err instanceof Error ? err.message : err)}` }, { status: 502 });
    }
  }

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
