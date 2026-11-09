// Reddit pieces shared by the API route and the widget: the optional app
// credentials (one setting per account, used by every Reddit widget) and the
// mapping from Reddit's JSON listing to the widget's post shape.

export const REDDIT_API_KEY = "reddit-api";

export type RedditApiConfig = { clientId: string; clientSecret: string };

// The stored credentials, or null when unset or incomplete (then the public
// feed is used).
export function parseRedditApi(raw: string | null | undefined): RedditApiConfig | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { clientId?: unknown; clientSecret?: unknown } | null;
    const clientId = String(v?.clientId ?? "").trim();
    const clientSecret = String(v?.clientSecret ?? "").trim();
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

export type RedditPost = {
  title: string;
  link: string;
  pubDate: string;
  score: number;
  subreddit: string;
  content: string;
  thumbnail: string;
  image: string;
};

type ApiChild = {
  data?: {
    title?: string;
    permalink?: string;
    created_utc?: number;
    score?: number;
    subreddit?: string;
    selftext_html?: string | null;
    thumbnail?: string;
    url_overridden_by_dest?: string;
    url?: string;
    preview?: { images?: { source?: { url?: string } }[] };
  };
};

// A `/r/<name>/top.json?raw_json=1` listing to posts. raw_json keeps the HTML
// and URLs unescaped, so `selftext_html` is the markup the widget's sanitizer
// expects and preview URLs work as they are.
export function mapListing(json: unknown, fallbackSubreddit: string, limit: number): RedditPost[] {
  const children = (json as { data?: { children?: ApiChild[] } } | null)?.data?.children ?? [];
  return children
    .slice(0, limit)
    .map(ch => {
      const d = ch.data ?? {};
      const thumbnail = /^https?:\/\//.test(d.thumbnail ?? "") ? d.thumbnail! : "";
      const direct = d.url_overridden_by_dest ?? d.url ?? "";
      const image =
        d.preview?.images?.[0]?.source?.url ??
        (/\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(direct) ? direct : "");
      return {
        title: d.title ?? "",
        link: d.permalink ? `https://www.reddit.com${d.permalink}` : "",
        pubDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : "",
        score: typeof d.score === "number" ? d.score : 0,
        subreddit: d.subreddit ?? fallbackSubreddit,
        content: d.selftext_html ?? "",
        thumbnail,
        image,
      };
    })
    .filter(p => p.title && p.link);
}
