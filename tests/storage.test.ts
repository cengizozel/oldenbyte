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
