# Chat Widget

Chat with any model exposed over an **OpenAI-compatible** HTTP API — a locally
hosted server (Ollama, LM Studio, llama.cpp, vLLM, …) or a hosted provider.
Responses stream token-by-token and the conversation is saved.

## Storage Keys

| Key | Value |
|---|---|
| `chat-widget-{id}` | JSON: `{ config, conversations: [{ id, title, messages, updatedAt, characterId }], activeId, characters: [{ id, name, emoji, persona, focus, memories }], activeCharacterId }` |

`config` holds: `baseUrl, apiKey, model, system, useDashboard, maxTokens, length, effort, useKiwix, kiwixUrl, kiwixSource, kiwixSourceTitle, useAnytype, anytypeUrl, anytypeApiKey, anytypeSpaceId, anytypeSpaceName, keepAlive`.

The legacy single-conversation shape (`{ config, messages }`) is migrated to one conversation on load. Older configs without `characters` get a default **Assistant** character seeded on load (so existing chats are unaffected).

- `baseUrl` — the API base, e.g. `http://localhost:11434/v1`. `/chat/completions` and `/models` are appended to it.
- `apiKey` — sent as `Authorization: Bearer <key>` when set. The settings field is **currently hidden** (local-only mode), so this is always empty and no key is stored. Re-add the field in `ChatWidget.tsx` (and stop forcing `apiKey: ""` in `saveSettings`) to use hosted providers.
- `model` — the model id, e.g. `llama3.2`. The settings panel can **Load models** from `{baseUrl}/models` to populate a picker.
- `system` — optional system prompt prepended to every request.
- `useDashboard` — when `true`, a snapshot of your dashboard data is injected as context so the model can answer questions about it (see below).
- `maxTokens` — caps the reply length, sent upstream as `max_tokens`. `0` omits the field so the server uses its own default.
- `length` — response-style preset (`default` / `concise` / `balanced` / `detailed`). Each appends a brevity instruction to the system prompt and, when selected, fills `maxTokens` with a suggested cap (which can then be edited). `concise` ≈ 2-3 sentences (256 tokens), `balanced` ≈ a paragraph or two (768), `detailed` is thorough with no cap.
- `effort` — thinking budget for reasoning models (qwen3, deepseek-r1, …), sent as OpenAI `reasoning_effort`. `default` omits the field; **`none` turns chain-of-thought off** (much faster for simple chats); `low`/`medium`/`high` scale it up. Servers/models without reasoning ignore it.
- `useKiwix` / `kiwixUrl` / `kiwixSource` / `kiwixSourceTitle` — Kiwix agentic-lookup toggle and connection (see [Kiwix lookup](#kiwix-and-anytype-lookup)).
- `useAnytype` / `anytypeUrl` / `anytypeApiKey` / `anytypeSpaceId` / `anytypeSpaceName` — Anytype lookup toggle and the paired connection (see [Anytype lookup](#kiwix-and-anytype-lookup)).
- `keepAlive` — model-residency preference for Ollama/LM Studio (see [Model residency](#model-residency-ollama--lm-studio)). `""` = server default, `"5m"`/`"30m"`/`"1h"` = linger that long, `"-1"` = stay loaded.
- `messages` — the full conversation, persisted after each completed turn.
- `characters` / `activeCharacterId` — personas with scoped memory (see [Characters](#characters--scoped-memory)). Each conversation records its `characterId`.

## Configuration

Hover the widget and click the pencil to open settings. Quick-fill presets are
provided for Ollama (`:11434`), LM Studio (`:1234`), and llama.cpp (`:8080`).
Save is disabled until both an API URL and a model are set.

## Behaviour

- **Streaming** — replies stream in real-time via `POST /api/chat` with `stream: true`. The **Stop** button aborts the in-flight request and keeps whatever streamed so far.
- **Thinking** — reasoning models (qwen3, deepseek-r1, …) stream their chain-of-thought in a separate `delta.reasoning` field (with empty `content`). The `/api/chat` route re-wraps it inline as `<think>…</think>`, and the client (`splitThinking`/`ThinkBlock` in `ChatWidget.tsx`) shows it as a collapsible "Thinking" block that auto-expands while the model is thinking, then collapses once the answer begins.
- **Markdown** — assistant replies are rendered as Markdown (headings, bold/italic, lists, inline code, fenced code blocks, blockquotes, links) by a small in-house renderer in `components/Markdown.tsx` — no external dependency. User messages stay plain text.
- **Live status** — while waiting, a caption under the reply shows `thinking… {s}s` (switching to `loading model / thinking…` past 3s, since a cold model load shows up as latency before the first token), then `generating… {s}s`.
- **Stats** — once a reply finishes, a footer reports `{tok/s} · {tokens} tokens · {total time} · {time to first token}`. Timings are measured client-side; the token count comes from a `\x1e`-delimited trailer the `/api/chat` route appends (it counts per-token deltas, exact for local servers that stream one token per chunk).
- **Edit a reply** — hover an assistant message and click the pencil to edit its raw Markdown in place (Save/Esc-to-cancel). Since the conversation is persisted and fed back as context, edits let you curate what the model sees on later turns. Editing clears that message's stats footer.
- **Edit / regenerate from a message** — hover one of *your* messages for two actions: the **pencil** edits it and reruns the conversation from that point, and the **↻** regenerates the reply from there unchanged (drops the old reply and anything after it). Both work on any user message, not just the last.
- **Multiple conversations** — the **chats icon** in the header switches the widget to a list of saved conversations (newest first); click one to open it, the **+** to start a new chat, or the **×** to delete one. Conversations are auto-titled from their first message. **Clear** wipes only the open conversation.
- **Send** — `Enter` sends, `Shift+Enter` inserts a newline. The composer **auto-grows** with multi-line input up to a cap (~160px), then scrolls.

## Ask about your dashboard data

The **database icon** in the header toggles "answer using my dashboard data".
When on, a status bar shows how much context was gathered, and before each
message a plain-text snapshot of your dashboard is injected as a system
`<dashboard>` block. This lets you ask things like *"what's new on arXiv?"* or
*"summarise my notes from last Tuesday"*.

What gets gathered (by [`lib/dashboardContext.ts`](../../lib/dashboardContext.ts)):

- **Notes** — the full history across every Notepad instance (from `notepad-registry` + each `notebook-{id}-dates`), newest first, grouped by date. This is included even though Notepad is not `digestable`.
- **Feeds** — the latest snapshot of each Text, F1, Feed (RSS), Reddit, YouTube, arXiv, and HF Daily widget on the layout, reusing each widget's date-keyed cache when present and otherwise fetching fresh.
- **Tracker** — time spent per activity for the most recent days that have entries.

The snapshot is gathered when the toggle is turned on (and cached for the
session). While the mode is active the header shows a **refresh** icon (re-gathers)
and an **eye** icon (opens an overlay with the full context sent to the model —
the framing instructions that explain what the data is, plus the `<dashboard>`
block itself), and a subtitle reports how much was gathered. Larger
dashboards produce more context — keep your local model's context window in
mind. Reader and Chess widgets are not included (no useful text).

## Kiwix and Anytype lookup

Two toggles behind the **+** button by the send box hand the model search tools so it can ground answers in a source it actually reads (agentic RAG), citing what it used:

- **Kiwix** (library icon) — searches an offline Kiwix library. Set it up under *Kiwix lookup* in settings (URL + book).
- **Anytype** (layers icon) — searches **your own Anytype notes**. Set it up under *Anytype lookup* in settings: enter the local API URL (default `http://127.0.0.1:31009`), **Pair with Anytype** (a 4-digit code appears in the desktop app), then pick a space.

When a toggle is on, the request carries a `kiwix` / `anytype` object and the route runs the agentic loop (see [`/api/chat`](../api.md#chat)). The model searches, reads the most relevant result, and answers with `[n]` citations rendered as a collapsible **Sources** list. Active toggles show as a filled pill so it's obvious when they're on.

**Anytype specifics** (the tools call [`lib/anytype.ts`](../../lib/anytype.ts) directly):
- `search_anytype` — full-text search; a multi-word query that finds nothing is retried as an **AND of its terms** (so "2026 journal" finds "Journal (2026)").
- `read_anytype_object` — reads a note's markdown body. Long notes come back in ~6k-char **parts**; the model can pass `find="keyword"` to jump to relevant sections or `page=N` to read sequentially, so it never overflows the context.
- `summarize_anytype_object` — **map-reduce** digest of a whole long note (e.g. "summarize my journal"): the server splits it into ~6k chunks, summarizes each on its own model call, and returns the per-part summaries for the model to synthesize. Progress streams into the thinking trail (`🧩 digesting … part k/N`).
- Search results and reads also carry each note's **Created / Last modified dates** and custom properties, so the model can answer "when did I write this" and questions about those fields.

## Model residency (Ollama / LM Studio)

When the configured server is Ollama or LM Studio, a status **pill** in the header shows whether the model is loaded (`● loaded`, with an unload countdown on Ollama) or `○ unloaded`. Clicking it gives controls to set how long the model lingers after a reply (`5m` / `30m` / `1h`), **pin** it loaded (`∞`), or **unload now** to free VRAM. Backed by [`/api/model`](../api.md#model); hidden for servers with no controllable residency (llama.cpp, vLLM, hosted). The choice is stored in `config.keepAlive` and re-applied after each reply (Ollama `keep_alive`) or sent as `ttl` on the request (LM Studio).

## Characters & scoped memory

The **emoji/people icon** in the header opens the **Characters** panel — personas you can create, edit, and switch between. Each character has a name, emoji, **persona** (its own system prompt), a **focus**, and a private list of **memories** about you.

- The active character's persona and memories are injected into the system prompt, so it answers in role and recalls what it knows about you.
- **Scoped auto-memory:** a character only auto-remembers if it has a non-empty `focus`. After each reply, a quiet background call (non-streaming `/api/chat`) reviews the exchange and saves *new* durable facts about you that match the focus, ignoring everything off-topic — so an education coach keeps your studies and ignores your trip. Memories are capped (40) and editable by hand in the character editor.
- Each conversation is tied to a character (its emoji follows the chat). The built-in **Assistant** has no focus → no memory, and uses the Settings system prompt, so default behaviour is unchanged.

## Why a server-side proxy

Requests go through [`/api/chat`](../api.md#chat) rather than directly from the
browser. This avoids CORS restrictions and HTTPS mixed-content blocking when the
dashboard is served over HTTPS but the model runs on plain `http://localhost`.
In local-only mode no API key is involved. (If the key field is re-enabled, the
key would be saved with the rest of the config in the database — move it to
`localStorage` first if that matters.)

This widget is not `digestable`.
