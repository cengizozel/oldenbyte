import { describe, expect, it } from "vitest";
import { parseFeed } from "@/lib/rss";

const item = (title: string, extra = "") => `<item><title>${title}</title><link>https://example.com/a</link>${extra}</item>`;

describe("parseFeed", () => {
  it("drops the publisher suffix an aggregator adds, when <source> names it", () => {
    const xml = `<rss><channel>${item("Stocks lift Wall Street - AP News", '<source url="https://apnews.com">AP News</source>')}</channel></rss>`;
    expect(parseFeed(xml, 5)[0].title).toBe("Stocks lift Wall Street");
  });
  it("leaves titles alone without a matching source", () => {
    const xml = `<rss><channel>${item("Rust - a review")}${item("Deal done - Reuters", "<source>AP News</source>")}</channel></rss>`;
    expect(parseFeed(xml, 5).map(i => i.title)).toEqual(["Rust - a review", "Deal done - Reuters"]);
  });
});
