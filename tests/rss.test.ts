import { describe, expect, it } from "vitest";
import { parseFeed } from "@/lib/rss";

describe("parseFeed", () => {
  it("parses RSS items with CDATA and entities", () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[First & best]]></title><link>https://a.example/1</link><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate><description>a &lt;b&gt;</description></item>
      <item><title>Second</title><guid>https://a.example/2</guid></item>
    </channel></rss>`;
    const items = parseFeed(xml, 10);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "First & best", link: "https://a.example/1", content: "a <b>" });
    expect(items[1].link).toBe("https://a.example/2");
  });

  it("parses Atom entries and respects the limit", () => {
    const xml = `<feed>
      <entry><title>One</title><link href="https://b.example/1"/><updated>2026-10-12T10:00:00Z</updated><summary>s1</summary></entry>
      <entry><title>Two</title><link href="https://b.example/2"/></entry>
    </feed>`;
    const items = parseFeed(xml, 1);
    expect(items).toEqual([{ title: "One", link: "https://b.example/1", pubDate: "2026-10-12T10:00:00Z", content: "s1" }]);
  });
});
