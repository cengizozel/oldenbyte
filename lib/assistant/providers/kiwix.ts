import { search as kiwixSearch, searchAllBooks, articleExtract } from "@/lib/kiwix";
import type { Provider, ProviderCtx, ToolSpec, ToolResult } from "@/lib/assistant/types";

// Kiwix provider: full-text search + article reads over the user's offline
// reference library (Wikipedia, WikiHow, whatever ZIMs the server holds).

export type KiwixConfig = { baseUrl: string; source?: string; sourceTitle?: string };

// Derive a readable title from a content url, e.g. /A/Lionel_Messi → "Lionel Messi".
function titleFromUrl(url: string): string {
  try {
    const seg = decodeURIComponent(url.split("/").filter(Boolean).pop() ?? "");
    return seg.replace(/_/g, " ").trim() || url;
  } catch { return url; }
}

export function kiwixProvider(cfg: KiwixConfig): Provider {
  const where = cfg.sourceTitle
    ? ` (currently: ${cfg.sourceTitle})`
    : " (searches every book on the server at once: Wikipedia, WikiHow, and anything else installed)";
  return {
    key: "kiwix",

    tools(): ToolSpec[] {
      return [
        {
          type: "function",
          function: {
            name: "search_kiwix",
            description:
              `Full-text search the user's offline Kiwix reference library${where}. ` +
              `Use this for factual, encyclopedic, or how-to questions where you need a source. ` +
              `This is a KEYWORD index (like a library catalog), not a question-answering engine: ` +
              `search the entity or article name, e.g. "Lionel Messi" — NOT a full question or extra ` +
              `words like "born"/"birth date", which hurt the ranking. ` +
              `Returns a numbered list of articles with titles, urls, and snippets; open the most ` +
              `relevant one with get_article to read the facts.`,
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Concise keywords — usually the article/entity name, no question words" },
              },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_article",
            description:
              "Fetch the lead text of a Kiwix article using a url returned by search_kiwix, " +
              "when a snippet isn't enough to answer.",
            parameters: {
              type: "object",
              properties: { url: { type: "string", description: "Article url from a search result" } },
              required: ["url"],
            },
          },
        },
      ];
    },

    async run(name, args, ctx: ProviderCtx): Promise<ToolResult | null> {
      if (name === "search_kiwix") {
        const q = String(args?.query ?? "").trim();
        if (!q) return { kind: "message", text: "No query provided." };
        const results = cfg.source
          ? await kiwixSearch(cfg.baseUrl, cfg.source, q, 6, ctx.signal)
          : await searchAllBooks(cfg.baseUrl, q, 6, ctx.signal);
        return {
          kind: "search", source: "kiwix", query: q,
          results: results.map(r => ({ title: r.title, ref: r.url, link: r.url, snippet: r.snippet })),
        };
      }
      if (name === "get_article") {
        const url = String(args?.url ?? "");
        if (!url) return { kind: "message", text: "No url provided." };
        const text = await articleExtract(cfg.baseUrl, url, ctx.signal);
        return { kind: "article", title: titleFromUrl(url), link: url, text: text || "No text found in that article." };
      }
      return null;
    },
  };
}
