import { describe, it, expect } from "vitest";
import { buildSeed, SEEDED_DASHBOARDS } from "@/lib/seed";
import { layoutKey, instancesKey } from "@/lib/dashboards";
import { instanceIdOf } from "@/lib/settingKeys";

type Item = { i: string; x: number; y: number; w: number; h: number; tabs?: string[] };

const COLS = 4;

describe("first-run seed", () => {
  const seed = buildSeed();

  for (const dash of SEEDED_DASHBOARDS.list) {
    const layout = seed[layoutKey(dash.id)] as Item[];
    const instances = seed[instancesKey(dash.id)] as Record<string, { id: string; type: string }>;

    describe(`dashboard ${dash.name}`, () => {
      it("fills a 4-column grid with no overlaps and no gaps", () => {
        const rows = Math.max(...layout.map(l => l.y + l.h));
        const cells = new Set<string>();
        for (const l of layout) {
          expect(l.x + l.w).toBeLessThanOrEqual(COLS);
          for (let x = l.x; x < l.x + l.w; x++) {
            for (let y = l.y; y < l.y + l.h; y++) {
              const key = `${x},${y}`;
              expect(cells.has(key), `${l.i} overlaps at ${key}`).toBe(false);
              cells.add(key);
            }
          }
        }
        expect(cells.size).toBe(COLS * rows);
      });

      it("has cards of more than one shape", () => {
        const shapes = new Set(layout.map(l => `${l.w}x${l.h}`));
        expect(shapes.size).toBeGreaterThan(2);
      });

      it("places every instance exactly once, as a cell or a tab", () => {
        const placed = layout.flatMap(l => [l.i, ...(l.tabs ?? [])]);
        expect(new Set(placed).size).toBe(placed.length);
        expect([...placed].sort()).toEqual(Object.keys(instances).sort());
        for (const [id, inst] of Object.entries(instances)) expect(inst.id).toBe(id);
      });
    });
  }

  it("includes at least one tab group", () => {
    const groups = SEEDED_DASHBOARDS.list.flatMap(d => (seed[layoutKey(d.id)] as Item[]).filter(l => l.tabs?.length));
    expect(groups.length).toBeGreaterThan(0);
  });

  it("keys every widget's data to a placed instance", () => {
    const placed = new Set(
      SEEDED_DASHBOARDS.list.flatMap(d => (seed[layoutKey(d.id)] as Item[]).flatMap(l => [l.i, ...(l.tabs ?? [])]))
    );
    for (const key of Object.keys(seed)) {
      const owner = instanceIdOf(key);
      if (owner) expect(placed.has(owner), `${key} belongs to unplaced ${owner}`).toBe(true);
    }
  });

  it("logs nothing in the future", () => {
    const now = Date.now();
    const upkeep = seed["upkeep-log-upkeep-home"] as Record<string, number[]>;
    for (const checks of Object.values(upkeep)) {
      expect(checks.every(t => t <= now)).toBe(true);
      expect([...checks].sort((a, b) => a - b)).toEqual(checks);
    }
    const rhythm = seed["rhythm-log-rhythm-study"] as { events: Record<string, number[]>; sessions: Record<string, [number, number][]> };
    for (const taps of Object.values(rhythm.events)) expect(taps.every(t => t <= now)).toBe(true);
    for (const sessions of Object.values(rhythm.sessions)) expect(sessions.every(([s, e]) => s < e && e <= now)).toBe(true);
  });
});
