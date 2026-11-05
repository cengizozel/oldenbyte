import { describe, expect, it } from "vitest";
import { liveIdsFrom, orphanGroups } from "@/lib/gc";

const t1 = new Date(Date.UTC(2026, 10, 1));
const t2 = new Date(Date.UTC(2026, 10, 2));

describe("liveIdsFrom", () => {
  it("collects every instance on every dashboard and every registered notepad", () => {
    const live = liveIdsFrom([
      { key: "widget-instances", value: JSON.stringify({ "text-home": {}, "notebook-home": {} }) },
      { key: "widget-instances:dash-1", value: JSON.stringify({ "upkeep-1": {} }) },
      { key: "notepad-registry", value: JSON.stringify(["notebook-home", "notebook-gone"]) },
    ]);
    expect([...live!].sort()).toEqual(["notebook-gone", "notebook-home", "text-home", "upkeep-1"]);
  });
  it("gives up on anything unreadable", () => {
    expect(liveIdsFrom([{ key: "widget-instances", value: "{" }])).toBeNull();
    expect(liveIdsFrom([{ key: "widget-instances", value: "[]" }])).toBeNull();
    expect(liveIdsFrom([{ key: "notepad-registry", value: "{}" }])).toBeNull();
  });
});

describe("orphanGroups", () => {
  const live = new Set(["text-home", "notebook-gone"]);
  it("groups leftover keys by the removed widget, largest first, and skips everything else", () => {
    const rows = [
      { key: "text-widget-text-home", bytes: 10, updatedAt: t1 },            // live
      { key: "text-widget-text-old", bytes: 10, updatedAt: t1 },             // leftover
      { key: "chat-chat-old-index", bytes: 100, updatedAt: t1 },             // leftover, same widget as next
      { key: "chat-chat-old-conv-a", bytes: 500, updatedAt: t2 },
      { key: "notebook-notebook-gone-days", bytes: 10, updatedAt: t1 },      // kept via the registry
      { key: "theme", bytes: 4, updatedAt: t1 },                              // global
      { key: "rss-widget-rss-old-2026-10-12", bytes: 999, updatedAt: t1 },   // cache key: never widget data
      { key: "mystery-key-1", bytes: 10, updatedAt: t1 },                     // unknown family
    ];
    expect(orphanGroups(rows, live)).toEqual([
      { id: "chat-old", bytes: 600, lastWrite: t2, keys: [rows[2], rows[3]] },
      { id: "text-old", bytes: 10, lastWrite: t1, keys: [rows[1]] },
    ]);
  });
});
