import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser } from "@/lib/http";

// TubeArchivist bridge for the YouTube widget. Server-side, like /api/kiwix
// and /api/anytype: the archive usually lives on the LAN over plain http.
// POST so the API token rides in the body, never in a URL or access log.
//
// {op:"ping", url, token}        -> {ok, version}
// {op:"check", url, token, ids, force?} -> {archived: string[]} (subset of ids)

const MAX_IDS = 100;
const CONCURRENCY = 6;

// Per-video archive status. The two answers age differently on purpose: an
// archived video stays archived, but "not archived" goes stale the moment the
// download finishes, so it is only trusted briefly. `force` (the widget's
// refresh button) skips the cache entirely.
const HIT_MS = 60 * 60 * 1000;
const MISS_MS = 2 * 60 * 1000;
const known = new Map<string, { at: number; has: boolean }>();

function root(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function taFetch(url: string, token: string, path: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${root(url)}${path}`, {
    headers: { Authorization: `Token ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal,
  });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const { op, url, token, ids, force } = await request.json().catch(() => ({}));
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "Missing or invalid TubeArchivist URL" }, { status: 400 });
  }
  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ error: "Missing API token" }, { status: 400 });
  }

  try {
    if (op === "ping") {
      const res = await taFetch(url, token, "/api/ping/", request.signal);
      if (res.status === 401 || res.status === 403) throw new Error("TubeArchivist rejected the token");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return NextResponse.json({ ok: data.response === "pong", version: data.version ?? "" });
    }

    if (op === "check") {
      const list = (Array.isArray(ids) ? ids : [])
        .filter((id): id is string => typeof id === "string" && /^[\w-]{6,20}$/.test(id))
        .slice(0, MAX_IDS);
      // The token is part of the cache key (hashed) so one account's archive
      // status is never served to a request made with another token.
      const scope = createHash("sha256").update(`${root(url)}|${token}`).digest("hex").slice(0, 16);
      const archived: string[] = [];
      let next = 0;
      async function worker() {
        while (next < list.length) {
          const id = list[next++];
          const key = `ta|${scope}|${id}`;
          const hit = known.get(key);
          let has = hit?.has ?? false;
          if (force === true || !hit || Date.now() - hit.at >= (hit.has ? HIT_MS : MISS_MS)) {
            try {
              const res = await taFetch(url, token, `/api/video/${id}/`);
              if (res.status === 404) has = false;
              else if (res.ok) has = true;
              else throw new Error(`HTTP ${res.status}`);
              if (known.size > 5000) known.clear();
              known.set(key, { at: Date.now(), has });
            } catch {
              // TubeArchivist unreachable: keep the last known answer.
            }
          }
          if (has) archived.push(id);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
      return NextResponse.json({ archived });
    }

    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
