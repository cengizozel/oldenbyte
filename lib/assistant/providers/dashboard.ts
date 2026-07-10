import { readWidgetData, type ReadOpts } from "@/lib/widgetData";
import type { Provider, ProviderCtx, ToolSpec, ToolResult } from "@/lib/assistant/types";
import { windowMarkdown } from "@/lib/assistant/window";

// Dashboard provider: the model gets a ROSTER of the user's widgets (ids,
// titles, types — never their content) and fetches a widget's live data only
// when it explicitly calls read_widget / search_dashboard. Widgets absent from
// the roster (not on any dashboard, or toggled off as a source) are invisible
// to the model.

export type DashWidget = { id: string; title: string; type: string };

// Cross-widget keyword search: phrase first, then individual terms, up to 3
// merged ±200-char windows per widget, ~3000 chars total.
function searchWidgets(widgets: (DashWidget & { text: string })[], query: string): { text: string; hitIds: string[] } {
  const phrase = query.toLowerCase().trim();
  const terms = [phrase, ...phrase.split(/\s+/).filter(t => t.length >= 3 && t !== phrase)];
  const out: string[] = [];
  const hitIds: string[] = [];
  let budget = 3000;
  for (const w of widgets) {
    const text = w.text || "";
    const hay = text.toLowerCase();
    const windows: [number, number][] = [];
    for (const t of terms) {
      let idx = hay.indexOf(t);
      while (idx !== -1 && windows.length < 3) {
        windows.push([Math.max(0, idx - 200), Math.min(text.length, idx + t.length + 200)]);
        idx = hay.indexOf(t, idx + t.length);
      }
      if (windows.length) break; // phrase tier matched; skip looser term tiers
    }
    if (!windows.length) continue;
    windows.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of windows) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r);
    }
    const body = merged
      .map(([a, b]) => `${a > 0 ? "…" : ""}${text.slice(a, b)}${b < text.length ? "…" : ""}`)
      .join("\n");
    const seg = `## ${w.id} "${w.title}" (${w.type})\n${body}`;
    if (seg.length > budget) break;
    out.push(seg);
    hitIds.push(w.id);
    budget -= seg.length;
  }
  if (!out.length) {
    return {
      text: `No matches for "${query}" in any widget. Try read_widget on a likely widget, or different keywords.`,
      hitIds,
    };
  }
  return { text: out.join("\n\n"), hitIds };
}

export function dashboardProvider(widgets: DashWidget[], readOpts?: ReadOpts): Provider {
  const roster = widgets.map(w => `- ${w.id}: "${w.title}" (${w.type})`).join("\n");
  return {
    key: "dashboard",

    tools(): ToolSpec[] {
      return [
        {
          type: "function",
          function: {
            name: "read_widget",
            description:
              "Read the live content of one widget on the user's dashboard (notes, feeds, tracker, headlines...). " +
              "Long content is returned in parts: use find=\"keywords\" to jump to matching sections, or page=N " +
              "to read sequentially. Widgets available right now:\n" + roster,
            parameters: {
              type: "object",
              properties: {
                id: { type: "string", description: "Widget id from the list above" },
                find: { type: "string", description: "Optional: jump to sections matching these keywords" },
                page: { type: "integer", description: "Optional: which part to read (1-based)" },
              },
              required: ["id"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_dashboard",
            description:
              "Search across ALL dashboard widgets at once. Returns matching sections labeled with their " +
              "widget ids. Use this when you don't know which widget holds the answer (e.g. \"where did I " +
              "mention the dentist\").",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Concise keywords to find" },
              },
              required: ["query"],
            },
          },
        },
      ];
    },

    async run(name, args, ctx: ProviderCtx): Promise<ToolResult | null> {
      if (name === "read_widget") {
        const id = String(args?.id ?? "").trim();
        const w =
          widgets.find(x => x.id === id) ??
          // Forgiving fallbacks: models sometimes pass the title or type instead.
          widgets.find(x => x.title.toLowerCase() === id.toLowerCase()) ??
          widgets.find(x => x.type === id.toLowerCase());
        if (!w) {
          return { kind: "message", text: `No widget "${id}". Valid ids: ${widgets.map(x => x.id).join(", ")}` };
        }
        const data = await readWidgetData(ctx.userId, w.id, w.type, w.title, readOpts);
        const win = windowMarkdown(data, args?.find ? String(args.find) : undefined, args?.page ? Number(args.page) : undefined);
        const text = (win.header ? win.header + "\n" : "") + (win.text || "(this widget has no content right now)");
        return { kind: "widget", note: `reading widget "${w.title}"`, text };
      }
      if (name === "search_dashboard") {
        const q = String(args?.query ?? "").trim();
        if (!q) return { kind: "message", text: "No query provided." };
        // Fetch every readable widget live, then window-match across them.
        const settled = await Promise.allSettled(
          widgets.slice(0, 20).map(async w => ({
            id: w.id, title: w.title, type: w.type,
            text: await readWidgetData(ctx.userId, w.id, w.type, w.title, readOpts),
          }))
        );
        const filled = settled
          .filter((r): r is PromiseFulfilledResult<DashWidget & { text: string }> => r.status === "fulfilled")
          .map(r => r.value);
        const { text, hitIds } = searchWidgets(filled, q);
        const note = hitIds.length
          ? `searching dashboard for "${q}" — matches in ${hitIds.join(", ")}`
          : `searching dashboard for "${q}" — no matches`;
        return { kind: "widget", note, text };
      }
      return null;
    },
  };
}
