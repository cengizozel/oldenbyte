import { anytypeSearch, anytypeReadObject, anytypeDeepLink } from "@/lib/anytype";
import { bridgeRpc, getStyleHint, type BridgeConfig } from "@/lib/assistant/bridge";
import { windowMarkdown } from "@/lib/assistant/window";
import type { Provider, ProviderCtx, ToolSpec, ToolResult, WriteMode } from "@/lib/assistant/types";

// Anytype provider. Reads (search + object bodies) go through Anytype's local
// HTTP API, like the widget. Writes need the deeper gRPC surface, which only
// the write bridge (tools/anytype-bridge) can reach — so the write tools appear
// only when a bridge is configured, and note creation is block-level: real
// headers, bullets, and checkboxes, shaped to match the space's own style
// (the bridge's structural style profile is embedded in the tool description).
//
// summarize_anytype_object is intentionally NOT here: it needs the model caller
// for its map-reduce subcalls, so the loop owns it (see route.ts).

export type AnytypeConfig = {
  baseUrl: string;
  apiKey: string;
  spaceId: string;
  spaceName?: string;
  bridge?: BridgeConfig;      // unlocks writes
  writeMode: WriteMode;
};

export function anytypeProvider(cfg: AnytypeConfig): Provider {
  const where = cfg.spaceName ? ` (space: ${cfg.spaceName})` : "";
  let styleHint = "";

  const confirmNote = cfg.writeMode === "confirm"
    ? " The user must approve a confirmation card before anything is written; tell them it is awaiting confirmation, never claim it was saved."
    : " This writes immediately; report exactly what you created.";

  return {
    key: "anytype",

    async init(signal) {
      if (cfg.bridge) styleHint = await getStyleHint(cfg.bridge, cfg.spaceId, signal);
    },

    tools(): ToolSpec[] {
      const tools: ToolSpec[] = [
        {
          type: "function",
          function: {
            name: "search_anytype",
            description:
              `Full-text search the user's own Anytype notes and objects${where}. ` +
              `Use this for anything about the user's personal knowledge: their notes, journals, ` +
              `trips, people, projects, bookmarks. Search by name or keyword, e.g. "Istanbul" or ` +
              `"reading list". Returns a numbered list of objects with names, ids, and snippets; ` +
              `open the most relevant one with read_anytype_object to read its full text.`,
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Concise keywords — usually the note/object name or topic" },
              },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "summarize_anytype_object",
            description:
              "Digest an ENTIRE long note that's too big to read at once — use this for open-ended " +
              "questions about a whole note, e.g. \"summarize my journal\" or \"what does my 2026 journal " +
              "say about me\". It splits the note into parts, summarizes each, and returns the per-part " +
              "summaries for you to synthesize into the answer. (For a single specific fact, use " +
              "read_anytype_object with find= instead — it's much faster.)",
            parameters: {
              type: "object",
              properties: {
                id: { type: "string", description: "Object id from a search result" },
                focus: { type: "string", description: "Optional: what to focus on, e.g. 'what it reveals about the author'" },
              },
              required: ["id"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "read_anytype_object",
            description:
              "Read the markdown body of an Anytype object using an id returned by search_anytype. " +
              "Long notes are returned in parts — the result tells you the total size and how many " +
              "parts there are. For a long note, prefer find=\"keywords\" to jump straight to the " +
              "relevant sections (e.g. find=\"Istanbul\" in a journal), or page=N to read it part by " +
              "part and summarize across parts. Omit both to read from the start.",
            parameters: {
              type: "object",
              properties: {
                id: { type: "string", description: "Object id from a search result" },
                find: { type: "string", description: "Optional: jump to sections matching these keywords" },
                page: { type: "integer", description: "Optional: which part to read (1-based) when reading a long note sequentially" },
              },
              required: ["id"],
            },
          },
        },
      ];

      if (cfg.bridge) {
        const style = styleHint ? ` STYLE: ${styleHint}` : "";
        tools.push(
          {
            type: "function",
            function: {
              name: "create_anytype_object",
              description:
                `Create a new note/object in the user's Anytype space${where}. ONLY call this when the user ` +
                `explicitly asks to save, note down, or add something to Anytype.${confirmNote} ` +
                `Write the body as markdown — headings (##), bullets (-), checkboxes (- [ ]), code fences — ` +
                `it becomes real Anytype blocks.${style}`,
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Object title — match the user's usual title style" },
                  type_name: { type: "string", description: "Object type by name (e.g. Note, Task, Page); omit for a plain page" },
                  markdown: { type: "string", description: "Body as markdown" },
                  icon_emoji: { type: "string", description: "Optional single emoji icon" },
                },
                required: ["name", "markdown"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "append_to_anytype_object",
              description:
                `Append content to an EXISTING Anytype object (found via search_anytype). ONLY call this when ` +
                `the user explicitly asks to add to a specific note.${confirmNote} Markdown becomes real blocks.`,
              parameters: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Object id from a search result" },
                  markdown: { type: "string", description: "Content to append, as markdown" },
                },
                required: ["id", "markdown"],
              },
            },
          },
        );
      }
      return tools;
    },

    async run(name, args, ctx: ProviderCtx): Promise<ToolResult | null> {
      if (name === "search_anytype") {
        const q = String(args?.query ?? "").trim();
        if (!q) return { kind: "message", text: "No query provided." };
        const hits = await anytypeSearch(cfg.baseUrl, cfg.apiKey, cfg.spaceId, q, 6, ctx.signal);
        return {
          kind: "search", source: "anytype", query: q,
          results: hits.map(o => ({
            title: o.name, ref: o.id, link: anytypeDeepLink(o.spaceId, o.id), snippet: o.snippet || o.type,
            meta: [o.created && `created ${o.created}`, o.modified && `modified ${o.modified}`].filter(Boolean).join(", "),
          })),
        };
      }

      if (name === "read_anytype_object") {
        const id = String(args?.id ?? "");
        if (!id) return { kind: "message", text: "No id provided." };
        const obj = await anytypeReadObject(cfg.baseUrl, cfg.apiKey, cfg.spaceId, id, ctx.signal);
        const meta = [
          obj.type && `Type: ${obj.type}`,
          obj.created && `Created: ${obj.created}`,
          obj.modified && `Last modified: ${obj.modified}`,
          ...obj.fields.map(f => `${f.name}: ${f.value}`),
        ].filter(Boolean).join("\n");
        // Window long notes so they don't overflow the model's context.
        const win = windowMarkdown(obj.markdown || "", args?.find ? String(args.find) : undefined, args?.page ? Number(args.page) : undefined);
        const text = (win.header ? win.header + "\n" : "") + (win.text || "(no body text)");
        return { kind: "article", title: obj.name, link: anytypeDeepLink(cfg.spaceId, id), text, meta };
      }

      if (name === "create_anytype_object" && cfg.bridge) {
        const objName = String(args?.name ?? "").trim();
        const markdown = String(args?.markdown ?? "");
        if (!objName || !markdown.trim()) return { kind: "message", text: "Missing name or markdown." };
        const typeName = String(args?.type_name ?? "").trim();
        const icon = String(args?.icon_emoji ?? "").trim();
        const detail = [typeName || "Page", cfg.spaceName || "Anytype"].join(" · ");

        if (cfg.writeMode === "auto") {
          const out = await bridgeRpc<{ object_id: string; blocks_added: number }>(
            cfg.bridge, "create_object",
            { space_id: cfg.spaceId, name: objName, type_name: typeName || undefined, markdown, icon_emoji: icon || undefined },
            ctx.signal,
          );
          return {
            kind: "action",
            note: `created "${objName}" in Anytype (${out.blocks_added} blocks)`,
            text: `Done: created "${objName}" in the user's Anytype space (${out.blocks_added} blocks). Confirm this to the user.`,
            action: { kind: "anytype-create", summary: `Created "${objName}"`, detail },
          };
        }
        return {
          kind: "proposal",
          note: `proposing Anytype note "${objName}"`,
          text:
            `Proposed creating "${objName}" in the user's Anytype space. It is NOT saved yet: the user sees ` +
            `a confirmation card (with the full content) and must approve it. Tell them it is awaiting ` +
            `their confirmation; never claim it was saved.`,
          proposal: {
            kind: "anytype-create",
            summary: `Create "${objName}"`,
            detail,
            payload: { spaceId: cfg.spaceId, name: objName, typeName: typeName || undefined, markdown, iconEmoji: icon || undefined },
          },
        };
      }

      if (name === "append_to_anytype_object" && cfg.bridge) {
        const id = String(args?.id ?? "").trim();
        const markdown = String(args?.markdown ?? "");
        if (!id || !markdown.trim()) return { kind: "message", text: "Missing id or markdown." };
        // Resolve the object's name so cards and confirmations are readable.
        let objName = id;
        try {
          objName = (await anytypeReadObject(cfg.baseUrl, cfg.apiKey, cfg.spaceId, id, ctx.signal)).name || id;
        } catch { /* name is cosmetic */ }

        if (cfg.writeMode === "auto") {
          const out = await bridgeRpc<{ blocks_added: number }>(
            cfg.bridge, "append_markdown", { object_id: id, markdown }, ctx.signal,
          );
          return {
            kind: "action",
            note: `appended to "${objName}" (${out.blocks_added} blocks)`,
            text: `Done: appended ${out.blocks_added} blocks to "${objName}". Confirm this to the user.`,
            action: { kind: "anytype-append", summary: `Appended to "${objName}"` },
          };
        }
        return {
          kind: "proposal",
          note: `proposing to append to "${objName}"`,
          text:
            `Proposed appending to "${objName}". It is NOT saved yet: the user sees a confirmation card ` +
            `and must approve it. Tell them it is awaiting their confirmation; never claim it was saved.`,
          proposal: {
            kind: "anytype-append",
            summary: `Append to "${objName}"`,
            payload: { objectId: id, markdown },
          },
        };
      }

      return null;
    },
  };
}
