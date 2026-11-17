import { describe, expect, it } from "vitest";
import { searchTarget } from "@/components/SearchWidget";
import { cityOf, offsetText, resolveZone, wallClock } from "@/components/ClockWidget";

describe("search widget", () => {
  it("sends a query to the chosen engine, encoded", () => {
    expect(searchTarget("a b&c", { engine: "duckduckgo", custom: "" })).toBe("https://duckduckgo.com/?q=a%20b%26c");
  });
  it("opens an address as it is", () => {
    expect(searchTarget(" https://example.com/x?y=1 ", { engine: "google", custom: "" })).toBe("https://example.com/x?y=1");
  });
  it("uses a custom address with %s, and refuses one without", () => {
    expect(searchTarget("cats", { engine: "custom", custom: "https://s.example/search?q=%s" })).toBe("https://s.example/search?q=cats");
    expect(searchTarget("cats", { engine: "custom", custom: "https://s.example/" })).toBeNull();
  });
  it("does nothing for an empty query", () => {
    expect(searchTarget("   ", { engine: "google", custom: "" })).toBeNull();
  });
});

describe("clock widget", () => {
  const zones = ["Asia/Tokyo", "Europe/Istanbul", "America/Argentina/Buenos_Aires"];
  it("names a city from its zone id", () => {
    expect(cityOf("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
  it("resolves a city name or an id, in any case", () => {
    expect(resolveZone("tokyo", zones)).toBe("Asia/Tokyo");
    expect(resolveZone("buenos aires", zones)).toBe("America/Argentina/Buenos_Aires");
    expect(resolveZone("europe/istanbul", zones)).toBe("Europe/Istanbul");
    expect(resolveZone("Nowhere/Land", zones)).toBeNull();
  });
  it("words the difference", () => {
    expect(offsetText(0)).toBe("same time");
    expect(offsetText(180)).toBe("3h ahead");
    expect(offsetText(-330)).toBe("5h 30m behind");
    expect(offsetText(45)).toBe("45m ahead");
  });
  it("measures the gap between two zones", () => {
    const at = new Date("2026-01-15T12:00:00Z");
    expect((wallClock("Asia/Tokyo", at) - wallClock("UTC", at)) / 60000).toBe(540);
    expect((wallClock("Asia/Kolkata", at) - wallClock("UTC", at)) / 60000).toBe(330);
  });
});
