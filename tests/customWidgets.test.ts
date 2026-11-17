import { describe, it, expect } from "vitest";
import {
  ELEVATED_OFF, frameDocument, framePolicy, innerDocument, missingPowers, parseElevated, parseExtId, parseWidgetFile,
  settingValues, templateIdOf, validateManifest, extId, type CustomManifest, type FrameInit,
} from "@/lib/customWidgets";
import { parseCatalog, newerVersion } from "@/lib/widgetCatalog";
import { instanceIdOf } from "@/lib/settingKeys";

const manifest: CustomManifest = { format: 1, id: "demo", name: "Demo", description: "A demo.", version: "1.2.3" };
const file = (m: unknown, body = "<p>hi</p>") => `<script type="application/json" id="oldenbyte-widget">${JSON.stringify(m)}</script>${body}`;
const init: FrameInit = {
  instance: { id: "yours-demo-1", title: "Demo" }, widget: { id: "demo", name: "Demo", version: "1.2.3" },
  settings: {}, powers: [], theme: { dark: false, text: "#000", muted: "#555", bg: "#fff", border: "#eee" }, visible: true,
};

describe("custom widget manifest", () => {
  it("accepts a minimal manifest", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("names every problem of a bad one", () => {
    const errors = validateManifest({ format: 2, id: "Bad Id", name: "", description: "x".repeat(200), version: "1", powers: ["root"], color: "pink", homepage: "http://x", defaultSize: { w: 9, h: 1 } });
    for (const part of ["format", "id", "name", "description", "version", "powers", "color", "homepage", "defaultSize"]) {
      expect(errors.some(e => e.includes(part))).toBe(true);
    }
  });

  it("checks settings fields", () => {
    const ok = { ...manifest, settings: [{ key: "a", label: "A", type: "select", options: [{ value: "1", label: "One" }, { value: "2", label: "Two" }], default: "1" }, { key: "b", label: "B", type: "toggle", default: true }] };
    expect(validateManifest(ok)).toEqual([]);
    expect(validateManifest({ ...manifest, settings: [{ key: "a", label: "A", type: "select" }] })[0]).toContain("options");
    expect(validateManifest({ ...manifest, settings: [{ key: "a", label: "A", type: "text" }, { key: "a", label: "B", type: "text" }] })[0]).toContain("repeated");
    expect(validateManifest({ ...manifest, settings: [{ key: "a", label: "A", type: "toggle", default: "yes" }] })[0]).toContain("default");
    expect(validateManifest({ ...manifest, settings: [{ key: "a", label: "A", type: "code" }] })[0]).toContain("type");
  });

  it("refuses repeated or unknown powers", () => {
    expect(validateManifest({ ...manifest, powers: ["network", "network"] }).length).toBe(1);
    expect(validateManifest({ ...manifest, powers: ["network", "widgets", "files"] })).toEqual([]);
  });
});

describe("widget files", () => {
  it("reads the manifest from the file", () => {
    const parsed = parseWidgetFile(file(manifest));
    expect(parsed.manifest?.id).toBe("demo");
  });

  it("takes the attributes in either order", () => {
    const html = `<script id='oldenbyte-widget' type='application/json'>${JSON.stringify(manifest)}</script>`;
    expect(parseWidgetFile(html).manifest?.name).toBe("Demo");
  });

  it("refuses a file without a manifest, with bad JSON, or too large", () => {
    expect(parseWidgetFile("<p>hi</p>").errors[0]).toContain("no manifest");
    expect(parseWidgetFile('<script type="application/json" id="oldenbyte-widget">{nope</script>').errors[0]).toContain("JSON");
    expect(parseWidgetFile(file(manifest, "x".repeat(600_000))).errors[0]).toContain("larger");
    expect(parseWidgetFile("").manifest).toBeNull();
    expect(parseWidgetFile(42).manifest).toBeNull();
  });

  it("does not take another script for the manifest", () => {
    expect(parseWidgetFile(`<script type="application/json" id="other">${JSON.stringify(manifest)}</script>`).manifest).toBeNull();
  });
});

describe("ids", () => {
  it("namespaces by source", () => {
    expect(extId("yours", "demo")).toBe("yours/demo");
    expect(parseExtId("community/demo")).toEqual({ source: "community", id: "demo" });
    expect(templateIdOf("community/demo")).toBe("community-demo");
  });

  it("refuses anything that could leave the folder", () => {
    for (const bad of ["demo", "other/demo", "yours/../x", "yours/a/b", "yours/", "yours/A", 7, null]) expect(parseExtId(bad)).toBeNull();
  });

  it("ties storage keys to their instance for cleanup", () => {
    expect(instanceIdOf("ext-widget-yours-demo-170")).toBe("yours-demo-170");
    expect(instanceIdOf("ext-summary-yours-demo-170")).toBe("yours-demo-170");
    expect(instanceIdOf("ext-data-yours-demo-170:some.key")).toBe("yours-demo-170");
  });
});

describe("elevated switches", () => {
  it("is all off unless stored as true", () => {
    expect(parseElevated(null)).toEqual(ELEVATED_OFF);
    expect(parseElevated("not json")).toEqual(ELEVATED_OFF);
    expect(parseElevated('{"allow":"yes","network":1}')).toEqual(ELEVATED_OFF);
    expect(parseElevated('{"allow":true,"network":true}')).toEqual({ allow: true, network: true, widgets: false, files: false });
  });

  it("needs the master switch and the power's own", () => {
    expect(missingPowers(["network"], ELEVATED_OFF)).toEqual(["network"]);
    expect(missingPowers(["network"], { ...ELEVATED_OFF, network: true })).toEqual(["network"]);
    expect(missingPowers(["network", "files"], { allow: true, network: true, widgets: false, files: false })).toEqual(["files"]);
    expect(missingPowers(["network"], { allow: true, network: true, widgets: false, files: false })).toEqual([]);
    expect(missingPowers(undefined, ELEVATED_OFF)).toEqual([]);
  });
});

describe("settings values", () => {
  const m: CustomManifest = { ...manifest, settings: [
    { key: "t", label: "T", type: "text", default: "d" },
    { key: "n", label: "N", type: "number", default: 3 },
    { key: "b", label: "B", type: "toggle" },
    { key: "s", label: "S", type: "select", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "b" },
  ] };

  it("falls back to defaults", () => {
    expect(settingValues(m, undefined)).toEqual({ t: "d", n: 3, b: false, s: "b" });
  });

  it("keeps saved values of the right type and drops the rest", () => {
    expect(settingValues(m, { t: "x", n: "7", b: true, s: "zzz", extra: 1 })).toEqual({ t: "x", n: 3, b: true, s: "b" });
  });
});

describe("the frame", () => {
  it("blocks every request except the ticket route", () => {
    const policy = framePolicy("https://dash.example");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("connect-src https://dash.example/api/custom-widgets/media");
    expect(policy).not.toMatch(/https:(?!\/\/dash\.example)/);
    expect(policy).not.toContain("*");
  });

  it("puts the policy on the outer frame and the widget in a sandboxed inner one", () => {
    const doc = frameDocument("<p>hi</p>", init, "https://dash.example");
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain('f.setAttribute("sandbox","allow-scripts")');
    expect(doc).not.toContain("allow-same-origin");
    expect(doc).not.toContain("allow-popups");
    expect(doc).not.toContain("allow-top-navigation");
  });

  it("cannot be broken out of by the widget's text or its settings", () => {
    const hostile = { ...init, settings: { x: "</script><script>alert(1)</script>" }, instance: { id: "i", title: "</script>" } };
    const inner = innerDocument("<p>x</p>", hostile);
    // The only closing script tag before the body is the SDK's own.
    expect(inner.slice(0, inner.indexOf("<body>")).match(/<\/script>/g)?.length).toBe(1);
    const outer = frameDocument("</script><script>parent.parent.postMessage('x','*')</script>", hostile, "https://dash.example");
    expect(outer.match(/<\/script>/g)?.length).toBe(1);
  });
});

describe("catalog", () => {
  const entry = { id: "demo", name: "Demo", description: "A demo.", version: "1.0.0", author: "A", powers: ["network"], reviewed: true, file: "widgets/demo/widget.html", sha256: "a".repeat(64), bytes: 10 };

  it("keeps valid entries", () => {
    const [e] = parseCatalog(JSON.stringify({ widgets: [entry] }));
    expect(e.id).toBe("demo");
    expect(e.powers).toEqual(["network"]);
    expect(e.reviewed).toBe(true);
  });

  it("drops entries that could mislead or escape", () => {
    const bad = [
      { ...entry, file: "../secret.html" },
      { ...entry, file: "https://evil.example/w.html" },
      { ...entry, sha256: "nope" },
      { ...entry, id: "Bad Id" },
      { ...entry, powers: ["root"] },
      { ...entry, name: "" },
    ];
    expect(parseCatalog(JSON.stringify({ widgets: bad }))).toEqual([]);
    expect(parseCatalog("not json")).toEqual([]);
    expect(parseCatalog(JSON.stringify({ widgets: [entry, entry] })).length).toBe(1);
  });

  it("treats reviewed as false unless it is exactly true", () => {
    expect(parseCatalog(JSON.stringify({ widgets: [{ ...entry, reviewed: "yes" }] }))[0].reviewed).toBe(false);
  });

  it("compares versions by number", () => {
    expect(newerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(newerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(newerVersion("0.9.9", "1.0.0")).toBe(false);
  });
});
