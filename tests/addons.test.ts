import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { validateAddon, addonOpenUrl, addonValues, fillTemplate, cleanBase, type Addon } from "@/lib/addons";
import { fromOldTa, activeArchive, parseArchive } from "@/lib/youtubeArchive";

const dir = path.join(process.cwd(), "addons");
const shipped = readdirSync(dir).filter(f => f.endsWith(".json")).map(f => [f, JSON.parse(readFileSync(path.join(dir, f), "utf8"))] as const);
const ta = shipped.find(([f]) => f === "tubearchivist.json")![1] as Addon;
const clone = (patch: object) => ({ ...structuredClone(ta), ...patch });

describe("add-on files", () => {
  it("every shipped add-on is valid", () => {
    for (const [file, def] of shipped) expect(validateAddon(def), file).toEqual([]);
    expect(shipped.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects requests that could leave the user's address", () => {
    expect(validateAddon(clone({ has: { path: "//evil.example/{id}" } }))).not.toEqual([]);
    expect(validateAddon(clone({ has: { path: "https://evil.example/{id}" } }))).not.toEqual([]);
    expect(validateAddon(clone({ has: { path: "/\\evil.example/{id}" } }))).not.toEqual([]);
    expect(validateAddon(clone({ open: "https://evil.example/?t={config.token}&v={id}" }))).not.toEqual([]);
    expect(validateAddon(clone({ open: "{config.url}.evil.example/{id}" }))).not.toEqual([]);
  });

  it("rejects unknown placeholders, bad headers and bad shapes", () => {
    expect(validateAddon(clone({ has: { path: "/v/{id}", headers: { Authorization: "{config.nope}" } } }))).not.toEqual([]);
    expect(validateAddon(clone({ has: { path: "/v/{id}", headers: { Host: "x" } } }))).not.toEqual([]);
    expect(validateAddon(clone({ has: { path: "/v/" } }))).not.toEqual([]);
    expect(validateAddon(clone({ ping: { path: "/p/{id}" } }))).not.toEqual([]);
    expect(validateAddon(clone({ slot: "reader.source" }))).not.toEqual([]);
    expect(validateAddon(clone({ config: [{ key: "token", label: "Token", type: "secret" }] }))).not.toEqual([]);
    expect(validateAddon(clone({ icon: "<img src=x onerror=alert(1)>" }))).not.toEqual([]);
    expect(validateAddon(null)).not.toEqual([]);
    expect(validateAddon([])).not.toEqual([]);
  });
});

describe("add-on values and links", () => {
  it("builds the link on the user's address and escapes the id", () => {
    expect(addonOpenUrl(ta, { url: "http://ta.lan:8000/" }, "abc_-123")).toBe("http://ta.lan:8000/video/abc_-123");
    expect(addonOpenUrl(ta, { url: "http://ta.lan:8000" }, "a/b?c")).toBe("http://ta.lan:8000/video/a%2Fb%3Fc");
    expect(addonOpenUrl(ta, { url: "javascript:alert(1)" }, "abc")).toBe("");
  });

  it("requires the required fields and real addresses", () => {
    expect(addonValues(ta, { url: " http://ta.lan:8000/ ", token: " t " })).toEqual({ url: "http://ta.lan:8000", token: "t" });
    expect(addonValues(ta, { url: "http://ta.lan:8000" })).toBeNull();
    expect(addonValues(ta, { url: "ta.lan", token: "t" })).toBeNull();
    expect(addonValues(ta, { url: "http://ta.lan", token: "t", serverUrl: "nope" })).toBeNull();
    expect(addonValues(ta, null)).toBeNull();
  });

  it("fills templates without letting a value break out", () => {
    expect(fillTemplate("Token {config.token}", { token: "a\r\nX-Evil: 1" }, null, false)).toBe("Token aX-Evil: 1");
    expect(fillTemplate("/api/video/{id}/", {}, "../../admin", true)).toBe("/api/video/..%2F..%2Fadmin/");
    expect(cleanBase("ftp://x")).toBe("");
  });
});

describe("the YouTube archive", () => {
  it("carries a built-in TubeArchivist connection over to the add-on", () => {
    expect(fromOldTa({ url: "http://ta", token: "t", open: "ta", serverUrl: "http://10.0.0.2", mark: "yt", only: true })).toEqual({
      addon: "tubearchivist", values: { url: "http://ta", token: "t", serverUrl: "http://10.0.0.2" }, open: "archive", mark: "youtube", only: true,
    });
    expect(fromOldTa({ url: "http://ta", token: "t", open: "youtube" })).toEqual({ addon: "tubearchivist", values: { url: "http://ta", token: "t" }, open: "youtube" });
    expect(fromOldTa({ url: "http://ta" })).toBeUndefined();
  });

  it("is active only when set to open there, with a known add-on and complete values", () => {
    const addons = [{ ...ta, source: "built-in" as const }];
    const cfg = parseArchive(JSON.stringify({ addon: "tubearchivist", values: { url: "http://ta", token: "t" }, open: "archive" }))!;
    expect(activeArchive(cfg, addons)?.values).toEqual({ url: "http://ta", token: "t" });
    expect(activeArchive({ ...cfg, open: "youtube" }, addons)).toBeNull();
    expect(activeArchive({ ...cfg, addon: "gone" }, addons)).toBeNull();
    expect(activeArchive({ ...cfg, values: { url: "http://ta" } }, addons)).toBeNull();
    expect(parseArchive("{broken")).toBeUndefined();
  });
});
