import { describe, expect, it } from "vitest";
import { decodeEntities, parseJson } from "@/lib/text";
import { localDateStr } from "@/lib/format";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("a &lt;b&gt; &quot;c&quot; &#39;d&#39; &#x27;e&#x27; &nbsp;")).toBe("a <b> \"c\" 'd' 'e'  ");
  });
  it("decodes &amp; last, so an escaped entity stays literal", () => {
    expect(decodeEntities("&amp;lt;tag&amp;gt;")).toBe("&lt;tag&gt;");
    expect(decodeEntities("width=640&amp;crop=smart")).toBe("width=640&crop=smart");
  });
  it("handles code points beyond the BMP", () => {
    expect(decodeEntities("&#128512;")).toBe("\u{1F600}");
  });
});

describe("parseJson", () => {
  it("parses valid JSON", () => {
    expect(parseJson<{ a: number }>('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });
  it("falls back on missing or corrupt input instead of throwing", () => {
    expect(parseJson("", 5)).toBe(5);
    expect(parseJson(null, 5)).toBe(5);
    expect(parseJson("{not json", 5)).toBe(5);
  });
});

describe("localDateStr", () => {
  it("formats the local calendar day with padding", () => {
    expect(localDateStr(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
