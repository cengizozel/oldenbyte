import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBOARD, cellDigit, cellFromKey, tabFromKey, parseKeyboardConfig, rebind, actionForKey } from "@/lib/keyboard";

describe("widget and tab numbers", () => {
  it("numbers cells 1..9 then 0", () => {
    expect(cellDigit(0)).toBe("1");
    expect(cellDigit(9)).toBe("0");
    expect(cellFromKey("0")).toBe(9);
    expect(cellFromKey("3")).toBe(2);
    expect(cellFromKey("a")).toBeNull();
  });
  it("maps digits 1..9 to tabs, nothing else", () => {
    expect(tabFromKey("1")).toBe(0);
    expect(tabFromKey("9")).toBe(8);
    expect(tabFromKey("0")).toBeNull();
    expect(tabFromKey("w")).toBeNull();
  });
  it("reads the target mark settings with defaults", () => {
    expect(parseKeyboardConfig(JSON.stringify({})).mark).toBe(3);
    expect(parseKeyboardConfig(JSON.stringify({})).markAlways).toBe(false);
    expect(parseKeyboardConfig(JSON.stringify({ mark: 0.1, markAlways: true }))).toMatchObject({ mark: 0.5, markAlways: true });
  });
  it("keeps a stored timeout within range", () => {
    expect(parseKeyboardConfig(JSON.stringify({ timeout: 4 })).timeout).toBe(4);
    expect(parseKeyboardConfig(JSON.stringify({ timeout: 99 })).timeout).toBe(10);
    expect(parseKeyboardConfig(JSON.stringify({ timeout: "x" })).timeout).toBe(1.5);
  });
});

describe("parseKeyboardConfig", () => {
  it("falls back to defaults for missing or broken input", () => {
    expect(parseKeyboardConfig(null)).toEqual(DEFAULT_KEYBOARD);
    expect(parseKeyboardConfig("{not json")).toEqual(DEFAULT_KEYBOARD);
  });
  it("keeps valid keys and drops invalid ones", () => {
    const c = parseKeyboardConfig(JSON.stringify({ enabled: false, leader: "5", bindings: { refresh: "g", settings: "7" } }));
    expect(c.enabled).toBe(false);
    expect(c.leader).toBe(" ");
    expect(c.bindings.refresh).toBe("g");
    expect(c.bindings.settings).toBe("e");
  });
});

describe("rebind", () => {
  it("swaps keys when the new key is taken", () => {
    const c = rebind(DEFAULT_KEYBOARD, "settings", "r");
    expect(c.bindings.settings).toBe("r");
    expect(c.bindings.refresh).toBe("e");
    expect(actionForKey(c, "r")).toBe("settings");
  });
});
