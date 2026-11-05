import { describe, expect, it, vi } from "vitest";

// Writes to one key must go out one at a time and the newest value must win
// (rapid layout drags used to land out of order).
describe("storage.setItem queue", () => {
  it("sends the first write, then only the newest waiting value, in order", async () => {
    const sent: string[] = [];
    let release: (() => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).value);
      if (sent.length === 1) await new Promise<void>(r => { release = r; });
      return new Response("{}", { status: 200 });
    }));
    const storage = await import("@/lib/storage");

    const a = storage.setItem("widget-layout", "A");
    const b = storage.setItem("widget-layout", "B");
    const c = storage.setItem("widget-layout", "C");
    await new Promise(r => setTimeout(r, 0));
    expect(sent).toEqual(["A"]);           // B and C wait for A
    expect(storage.pendingSaves()).toBe(2); // A in flight, C queued (B replaced)

    release!();
    expect(await Promise.all([a, b, c])).toEqual([true, true, true]);
    expect(sent).toEqual(["A", "C"]);      // B was superseded, C went last
    expect(storage.pendingSaves()).toBe(0);
    vi.unstubAllGlobals();
  });

  it("keeps different keys independent", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).key);
      return new Response("{}", { status: 200 });
    }));
    const storage = await import("@/lib/storage");
    await Promise.all([storage.setItem("k1", "x"), storage.setItem("k2", "y")]);
    expect(sent.sort()).toEqual(["k1", "k2"]);
    vi.unstubAllGlobals();
  });
});

describe("storage.setItem keepalive budget", () => {
  it("keeps concurrent keepalive bytes under the browser cap and retries a rejected keepalive", async () => {
    const calls: { key: string; keepalive: boolean }[] = [];
    let inFlight = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const { key } = JSON.parse(String(init.body));
      calls.push({ key, keepalive: !!init.keepalive });
      // Simulate the browser: a keepalive request past 64 KB in flight throws.
      if (init.keepalive) {
        if (inFlight + String(init.body).length > 64 * 1024) throw new TypeError("keepalive quota");
        inFlight += String(init.body).length; peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight -= String(init.body).length;
      }
      return new Response("{}", { status: 200 });
    }));
    const storage = await import("@/lib/storage");
    const big = "x".repeat(25_000);
    const results = await Promise.all(["a", "b", "c", "d"].map(k => storage.setItem(`cache-${k}`, big)));
    expect(results).toEqual([true, true, true, true]);
    expect(peak).toBeLessThan(64 * 1024);
    expect(calls.filter(c => c.keepalive).length).toBe(2); // only two fit the budget
    vi.unstubAllGlobals();
  });
});

// Every read remembers the key's version and every write sends it, so a stale
// page is refused instead of overwriting a newer save (see /api/settings).
describe("storage version handshake", () => {
  it("sends the version it read, keeps the one the server returns, and omits it for unread keys", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return new Response(JSON.stringify({ value: "v", version: 3 }), { status: 200 });
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return new Response(JSON.stringify({ ok: true, version: (body.version ?? 0) + 1 }), { status: 200 });
    }));
    const storage = await import("@/lib/storage");
    await storage.getItemResult("ver-a");
    expect(await storage.setItem("ver-a", "1")).toBe(true);
    expect(await storage.setItem("ver-a", "2")).toBe(true);
    expect(await storage.setItem("ver-unread", "x")).toBe(true);
    expect(bodies.map(b => b.version)).toEqual([3, 4, undefined]);
    vi.unstubAllGlobals();
  });

  it("reports a conflict as a failed save and stays stale until the page reloads", async () => {
    const versions: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return new Response(JSON.stringify({ value: "v", version: 3 }), { status: 200 });
      versions.push(JSON.parse(String(init.body)).version);
      return new Response(JSON.stringify({ error: "changed in another tab", conflict: true, version: 9 }), { status: 409 });
    }));
    const failures: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: CustomEvent<{ reason: string }>) => { if (e.type === "savefailed") failures.push(e.detail.reason); return true; }, location: {} });
    vi.stubGlobal("CustomEvent", class { type: string; detail: unknown; constructor(type: string, init: { detail: unknown }) { this.type = type; this.detail = init.detail; } });
    const storage = await import("@/lib/storage");
    await storage.getItemResult("ver-b");
    expect(await storage.setItem("ver-b", "1")).toBe(false);
    expect(await storage.setItem("ver-b", "2")).toBe(false);
    expect(versions).toEqual([3, 3]);
    expect(failures).toEqual(["changed in another tab", "changed in another tab"]);
    vi.unstubAllGlobals();
  });
});
