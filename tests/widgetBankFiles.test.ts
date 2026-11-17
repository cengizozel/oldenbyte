import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { buildRequest, fillPlaceholders, resolveText, secretKeys, usesOwnService, validateDef, type BankWidgetDef } from "@/lib/widgetBank";

const dir = path.join(process.cwd(), "widget-bank");
const files = readdirSync(dir).filter(f => f.endsWith(".json"));
const load = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as BankWidgetDef;

describe("the shipped widget files", () => {
  it.each(files)("%s is valid and named after its id", f => {
    const def = load(f);
    expect(validateDef(def)).toEqual([]);
    expect(`${def.id}.json`).toBe(f);
  });

  it("have unique ids", () => {
    const ids = files.map(f => load(f).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("send a secret only as the definition says, and never by default", () => {
    for (const f of files) {
      const def = load(f);
      for (const key of secretKeys(def)) {
        const used = def.fetch.url.includes(`{config.${key}}`) || Object.values(def.fetch.headers ?? {}).some(v => v.includes(`{config.${key}}`));
        expect(used, `${f}: secret "${key}" is asked for but never used`).toBe(true);
      }
    }
  });
});

const own: BankWidgetDef = {
  id: "own", title: "Own", description: "x",
  config: [{ key: "url", label: "Address", type: "url" }, { key: "apiKey", label: "Key", type: "secret" }, { key: "q", label: "Q", type: "text" }],
  fetch: { url: "{config.url}/api/items?q={config.q}&from={date}&to={date+7}", headers: { "X-Api-Key": "{config.apiKey}" } },
  items: { path: "$", title: "$.name" },
};

describe("widget file requests", () => {
  it("fills dates relative to today", () => {
    expect(fillPlaceholders("{date} {date+1} {date-1} {date+30}", {}, "2026-12-31", false)).toBe("2026-12-31 2027-01-01 2026-12-30 2027-01-30");
  });

  it("builds a request to the user's own address", () => {
    const req = buildRequest(own, { url: "http://sonarr.lan:8989/", apiKey: "k e y", q: "a b&c" }, "2026-11-17");
    expect(req).toEqual({
      url: "http://sonarr.lan:8989/api/items?q=a%20b%26c&from=2026-11-17&to=2026-11-24",
      headers: { "X-Api-Key": "k e y" },
      own: true,
    });
  });

  it("asks for the missing settings first", () => {
    expect(buildRequest(own, { url: "http://x", q: "" }, "2026-11-17")).toEqual({ error: 'Fill in "Key" in the settings.' });
    expect(buildRequest(own, { url: "", apiKey: "k" }, "2026-11-17")).toEqual({ error: 'Fill in "Address" in the settings.' });
    expect("error" in buildRequest(own, { url: "ftp://x", apiKey: "k" }, "2026-11-17")).toBe(true);
  });

  it("cannot be steered to another host by a setting", () => {
    const fixed: BankWidgetDef = { id: "fixed", title: "F", description: "x", config: [{ key: "user", label: "U", type: "text" }], fetch: { url: "https://api.example.com/u/{config.user}" }, items: { path: "$", title: "$.n" } };
    const req = buildRequest(fixed, { user: "../../evil.example/x?" }, "2026-11-17");
    expect(req).toMatchObject({ url: "https://api.example.com/u/..%2F..%2Fevil.example%2Fx%3F", own: false });
    // A header value stays on one line.
    const h = buildRequest(own, { url: "http://x", apiKey: "a\r\nX-Evil: 1", q: "" }, "2026-11-17");
    expect((h as { headers: Record<string, string> }).headers["X-Api-Key"]).toBe("aX-Evil: 1");
  });

  it("knows which definitions hold secrets or reach an own service", () => {
    expect(secretKeys(own)).toEqual(["apiKey"]);
    expect(usesOwnService(own)).toBe(true);
  });
});

describe("widget file validation", () => {
  const base = { id: "tt", title: "T", description: "d", items: { path: "$", title: "$.n" } };

  it("accepts https and own-address urls, refuses the rest", () => {
    expect(validateDef({ ...base, fetch: { url: "https://api.example.com/x" } })).toEqual([]);
    expect(validateDef({ ...base, config: [{ key: "url", label: "A", type: "url" }], fetch: { url: "{config.url}/x" } })).toEqual([]);
    expect(validateDef({ ...base, fetch: { url: "http://api.example.com/x" } }).length).toBe(1);
    expect(validateDef({ ...base, config: [{ key: "host", label: "H", type: "text" }], fetch: { url: "https://{config.host}/x" } }).length).toBe(1);
    expect(validateDef({ ...base, config: [{ key: "url", label: "A", type: "text" }], fetch: { url: "{config.url}/x" } }).length).toBe(1);
  });

  it("keeps an address setting at the start of the url only", () => {
    const config = [{ key: "url", label: "A", type: "url" }, { key: "other", label: "B", type: "url" }];
    expect(validateDef({ ...base, config, fetch: { url: "{config.url}/x?next={config.other}" } }).length).toBe(1);
    expect(validateDef({ ...base, config, fetch: { url: "{config.url}/x", headers: { Referer: "{config.other}" } } }).length).toBe(1);
  });

  it("checks headers and placeholders", () => {
    expect(validateDef({ ...base, fetch: { url: "https://a.example/x", headers: { Host: "evil" } } }).length).toBe(1);
    expect(validateDef({ ...base, fetch: { url: "https://a.example/x?k={config.missing}" } }).length).toBe(1);
    expect(validateDef({ ...base, fetch: { url: "https://a.example/x?d={date+3}" } })).toEqual([]);
    expect(validateDef({ ...base, config: [{ key: "k", label: "K", type: "secret", default: "x" }], fetch: { url: "https://a.example/x?k={config.k}" } }).length).toBe(1);
  });
});

describe("transforms", () => {
  it("formats bytes, percent and plain numbers", () => {
    expect(resolveText("$.b | bytes", { b: 1536 })).toBe("1.5 KB");
    expect(resolveText("$.b | bytes", { b: 5 * 1024 ** 3 })).toBe("5.0 GB");
    expect(resolveText("$.p | percent", { p: 99.52 })).toBe("99.5%");
    expect(resolveText("$.n | number", { n: 0 })).toBe("0");
    expect(resolveText("$.n | number", { n: 12345 })).toBe("12,345");
    expect(resolveText("$.n | number", {})).toBe("");
  });

  it("falls through a missing date to the next alternative", () => {
    expect(resolveText("$.a | dateShort || $.b | dateShort", { b: "2026-03-01T12:00:00Z" })).toBe("Mar 1");
  });
});
