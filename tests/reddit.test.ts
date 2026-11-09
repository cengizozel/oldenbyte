import { describe, it, expect } from "vitest";
import { mapListing, parseRedditApi } from "../lib/reddit";

const listing = {
  data: {
    children: [
      {
        data: {
          title: "A text post",
          permalink: "/r/selfhosted/comments/abc/a_text_post/",
          created_utc: 1_762_000_000,
          score: 42,
          subreddit: "selfhosted",
          selftext_html: "<div class=\"md\"><p>Hello &amp; welcome</p></div>",
          thumbnail: "self",
          url: "https://www.reddit.com/r/selfhosted/comments/abc/a_text_post/",
        },
      },
      {
        data: {
          title: "An image post",
          permalink: "/r/pics/comments/def/an_image_post/",
          created_utc: 1_762_000_100,
          score: 7,
          subreddit: "pics",
          selftext_html: null,
          thumbnail: "https://b.thumbs.redditmedia.com/x.jpg",
          url_overridden_by_dest: "https://i.redd.it/full.jpg",
          preview: { images: [{ source: { url: "https://preview.redd.it/full.jpg?width=1&s=2" } }] },
        },
      },
      { data: { title: "No link" } },
      { data: { title: "Third", permalink: "/r/pics/comments/ghi/third/" } },
    ],
  },
};

describe("mapListing", () => {
  it("maps a listing to posts, keeping the limit and dropping entries without a link", () => {
    const posts = mapListing(listing, "fallback", 3);
    expect(posts.map(p => p.title)).toEqual(["A text post", "An image post"]);
    expect(posts[0]).toMatchObject({
      link: "https://www.reddit.com/r/selfhosted/comments/abc/a_text_post/",
      pubDate: "2025-11-01T12:26:40.000Z",
      score: 42,
      subreddit: "selfhosted",
      content: "<div class=\"md\"><p>Hello &amp; welcome</p></div>",
      thumbnail: "",
      image: "",
    });
  });

  it("prefers the preview image and keeps a real thumbnail", () => {
    const [, image] = mapListing(listing, "fallback", 10);
    expect(image.thumbnail).toBe("https://b.thumbs.redditmedia.com/x.jpg");
    expect(image.image).toBe("https://preview.redd.it/full.jpg?width=1&s=2");
    expect(image.content).toBe("");
  });

  it("falls back to a direct image URL and the requested subreddit", () => {
    const posts = mapListing({ data: { children: [{ data: { title: "t", permalink: "/r/x/comments/1/t/", url: "https://i.imgur.com/a.png" } }] } }, "x", 5);
    expect(posts[0].image).toBe("https://i.imgur.com/a.png");
    expect(posts[0].subreddit).toBe("x");
    expect(posts[0].score).toBe(0);
  });

  it("survives garbage", () => {
    expect(mapListing(null, "x", 5)).toEqual([]);
    expect(mapListing({ data: {} }, "x", 5)).toEqual([]);
  });
});

describe("parseRedditApi", () => {
  it("needs both fields", () => {
    expect(parseRedditApi(null)).toBeNull();
    expect(parseRedditApi("not json")).toBeNull();
    expect(parseRedditApi(JSON.stringify({ clientId: "id" }))).toBeNull();
    expect(parseRedditApi(JSON.stringify({ clientId: " id ", clientSecret: "s" }))).toEqual({ clientId: "id", clientSecret: "s" });
  });
});
