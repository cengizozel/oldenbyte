import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";

// Backend-aware model-residency control. Local model servers manage VRAM
// differently, so this probes for a known one and adapts:
//
//   Ollama     — native /api/ps (status + unload time) and /api/generate with
//                keep_alive ("5m" | -1 stay | 0 unload). Exposes a countdown.
//   LM Studio  — REST /api/v1/models (status via per-model "state"), /models/load
//                (manual load = pinned, no auto-evict) and /models/unload. Its
//                linger is a `ttl` (seconds) set on the *inference* request, so
//                durations are applied by the chat route, not here. No countdown.
//
// Anything else (llama.cpp, vLLM, hosted OpenAI, …) keeps its model resident for
// the server's lifetime — there's nothing to control — so we report backend:null
// and the UI hides the control entirely.
//
// Proxied server-side (like /api/chat) to dodge CORS / mixed-content.

// The chat widget stores the OpenAI-compatible base (…/v1); strip it to reach
// each server's native API root.
function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

type Status = {
  backend: "ollama" | "lmstudio";
  // name = model id; expiresAt = unload time (Ollama only); loaded = residency
  // (LM Studio lists every model with a state, so presence ≠ loaded there).
  models: { name: string; expiresAt: string | null; loaded: boolean }[];
};

async function ollamaStatus(root: string, signal: AbortSignal): Promise<Status> {
  const res = await fetch(`${root}/api/ps`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // /api/ps lists only loaded models, so every entry is loaded.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = (data.models ?? []).map((m: any) => ({
    name: m.name ?? m.model,
    expiresAt: m.expires_at ?? null,
    loaded: true,
  }));
  return { backend: "ollama", models };
}

async function lmstudioStatus(root: string, signal: AbortSignal): Promise<Status> {
  const res = await fetch(`${root}/api/v1/models`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arr: any[] = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
  const models = arr.map((m) => ({
    name: m.id ?? m.key ?? m.model ?? m.name,
    expiresAt: null,
    loaded: (m.state ?? m.status) === "loaded",
  }));
  return { backend: "lmstudio", models };
}

// GET /api/model?baseUrl=… — detect the backend and report residency.
// GET /api/model?baseUrl=…&op=caps&model=… — report a model's capabilities
// (vision: true/false, or null when the backend doesn't say).
// Ollama's /api/ps and LM Studio's /api/v1/models are each unique to that
// server, so probing in turn can't false-positive on the other.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const baseUrl = request.nextUrl.searchParams.get("baseUrl");
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json({ backend: null, error: "Missing or invalid baseUrl" }, { status: 400 });
  }
  const root = trimBase(baseUrl);

  if (request.nextUrl.searchParams.get("op") === "caps") {
    const model = request.nextUrl.searchParams.get("model");
    if (!model) return NextResponse.json({ vision: null });
    // Ollama: /api/show lists capabilities ("completion", "tools", "vision"...).
    try {
      const res = await fetch(`${root}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: request.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.capabilities)) {
          return NextResponse.json({ vision: data.capabilities.includes("vision") });
        }
      }
    } catch { /* not Ollama */ }
    // LM Studio: model entries may carry capabilities or a vision flag.
    try {
      const res = await fetch(`${root}/api/v1/models`, { signal: request.signal });
      if (res.ok) {
        const data = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
        const m = arr.find(x => (x.id ?? x.key ?? x.model ?? x.name) === model);
        if (m) {
          if (Array.isArray(m.capabilities)) return NextResponse.json({ vision: m.capabilities.includes("vision") });
          if (typeof m.vision === "boolean") return NextResponse.json({ vision: m.vision });
        }
      }
    } catch { /* not LM Studio */ }
    return NextResponse.json({ vision: null }); // unknown backend: can't tell
  }

  try { return NextResponse.json(await ollamaStatus(root, request.signal)); } catch { /* not Ollama */ }
  try { return NextResponse.json(await lmstudioStatus(root, request.signal)); } catch { /* not LM Studio */ }
  return NextResponse.json({ backend: null });
}

// POST /api/model { baseUrl, backend, model, action, keepAlive? } — change residency.
//   ollama:   action "set"    → /api/generate keep_alive = keepAlive ("5m" | -1 | 0)
//   lmstudio: action "pin"    → /api/v1/models/load   (manual load, stays resident)
//             action "unload" → /api/v1/models/unload (instance_id = model)
//             (duration linger is a ttl on the chat request — handled in /api/chat)
export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const { baseUrl, backend, model, action, keepAlive } = await request.json();
  if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !model || !backend) {
    return NextResponse.json({ error: "Missing baseUrl, backend, or model" }, { status: 400 });
  }
  const root = trimBase(baseUrl);
  const json = { "Content-Type": "application/json" };
  try {
    if (backend === "ollama") {
      const res = await fetch(`${root}/api/generate`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ model, keep_alive: keepAlive, stream: false }),
        signal: request.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else if (backend === "lmstudio") {
      if (action === "unload") {
        const res = await fetch(`${root}/api/v1/models/unload`, {
          method: "POST", headers: json, body: JSON.stringify({ instance_id: model }), signal: request.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else if (action === "pin") {
        const res = await fetch(`${root}/api/v1/models/load`, {
          method: "POST", headers: json, body: JSON.stringify({ model }), signal: request.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      // durations are no-ops here — the ttl rides the next chat request.
    } else {
      return NextResponse.json({ error: `Unknown backend: ${backend}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
