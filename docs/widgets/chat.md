# Chat Widget

Chat with any model exposed over an **OpenAI-compatible** HTTP API: a locally
hosted server (Ollama, LM Studio, llama.cpp, vLLM, ...) or a hosted provider.
Responses stream token-by-token and conversations are saved.

## Storage Keys

| Key | Value |
|---|---|
| `chat-widget-{id}` | JSON: `{ config, conversations: [{ id, title, messages, updatedAt, characterId }], activeId, characters: [{ id, name, emoji, persona, focus, memories }], activeCharacterId }` |

`config` holds: `baseUrl, apiKey, model, system, useDashboard, dashboardWidgets, maxTokens, length, effort, useKiwix, kiwixUrl, kiwixSource, kiwixSourceTitle, useCalendar, useAnytype, anytypeUrl, anytypeApiKey, anytypeSpaceId, anytypeSpaceName, keepAlive`.

The legacy single-conversation shape (`{ config, messages }`) is migrated to one conversation on load. Older configs without `characters` get a default **Assistant** character seeded on load (so existing chats are unaffected).

- `baseUrl`: the API base, e.g. `http://localhost:11434/v1`. `/chat/completions` and `/models` are appended to it.
- `apiKey`: sent as `Authorization: Bearer <key>` when set. The settings field is **currently hidden** (local-only mode), so this is always empty and no key is stored. Re-add the field in `ChatWidget.tsx` (and stop forcing `apiKey: ""` in `saveSettings`) to use hosted providers.
- `model`: the model id, e.g. `llama3.2`. The settings panel can **Load models** from `{baseUrl}/models` to populate a picker.
- `system`: optional system prompt. An always-on `BASE_IDENTITY` block (the assistant knows it lives in this dashboard) is prepended regardless.
- `useDashboard`: dashboard lookup toggle; hands the model `read_widget`/`search_dashboard` tools (see below).
- `dashboardWidgets`: which widgets the lookup may read, by instance id. A **missing key counts as included**, so newly added widgets are searchable by default.
- `maxTokens`: caps the reply length, sent upstream as `max_tokens`. `0` omits the field so the server uses its own default.
- `length`: response-style preset (`default` / `concise` / `balanced` / `detailed`). Each appends a brevity instruction to the system prompt and, when selected, fills `maxTokens` with a suggested cap (which can then be edited). `concise` is roughly 2-3 sentences (256 tokens), `balanced` a paragraph or two (768), `detailed` is thorough with no cap.
- `effort`: thinking budget for reasoning models (qwen3, deepseek-r1, ...), sent as OpenAI `reasoning_effort`. `default` omits the field; **`none` turns chain-of-thought off** (much faster for simple chats); `low`/`medium`/`high` scale it up. Servers/models without reasoning ignore it.
- `useKiwix` / `kiwixUrl`: Kiwix lookup toggle and the kiwix-serve base URL. Lookups search **all books** on the server; `kiwixSource`/`kiwixSourceTitle` are a legacy single-book pin no longer set by the UI.
- `useCalendar`: calendar read/write tools, backed by the dashboard Calendar widget's CalDAV account (see [Calendar access](#calendar-access)).
- `useAnytype` / `anytypeUrl` / `anytypeApiKey` / `anytypeSpaceId` / `anytypeSpaceName`: Anytype lookup toggle and the paired connection.
- `keepAlive`: model-residency preference for Ollama/LM Studio (see [Model residency](#model-residency-ollama--lm-studio)). `""` = server default, `"5m"`/`"30m"`/`"1h"` = linger that long, `"-1"` = stay loaded.
- `characters` / `activeCharacterId`: personas with scoped memory (see [Characters](#characters--scoped-memory)). Each conversation records its `characterId`.

## Settings

Hover the widget and click the pencil. The panel is grouped into three sections:

- **Model**: the API URL, with quick-fill presets for Ollama (`:11434`), LM Studio (`:1234`), and llama.cpp (`:8080`), and the model, with a **Load models** button that fills a picker from `{baseUrl}/models` (a configured model not on the list shows as "custom"). Save is disabled until both are set.
- **Behavior**: system prompt, response style, thinking effort, and max response length (with 128/256/512/1024 shortcuts).
- **Data sources**: the per-widget dashboard checkboxes, the Kiwix library URL, and Anytype pairing. This section configures the *connections*; the lookup *toggles* live behind the **+** by the send box.

## Behaviour

- **Streaming**: replies stream in real-time via `POST /api/chat` with `stream: true`. The **Stop** button aborts the in-flight request and keeps whatever streamed so far.
- **Thinking**: reasoning models (qwen3, deepseek-r1, ...) stream their chain-of-thought in a separate `delta.reasoning` field (with empty `content`). The `/api/chat` route re-wraps it inline as `<think>...</think>`, and the client (`splitThinking`/`ThinkBlock` in `ChatWidget.tsx`) shows it as a collapsible "Thinking" block that auto-expands while the model is thinking, then collapses once the answer begins. Prior turns' thinking is stripped from the history sent upstream so it never crowds out the conversation.
- **Markdown**: assistant replies are rendered as Markdown (headings, bold/italic, lists, inline code, fenced code blocks, blockquotes, links) by a small in-house renderer in `components/Markdown.tsx`, no external dependency. User messages stay plain text.
- **Live status**: while waiting, a caption under the reply shows `thinking... {s}s` (switching to `loading model / thinking...` past 3s, since a cold model load shows up as latency before the first token), then `generating... {s}s`.
- **Stats**: once a reply finishes, a footer reports `{tok/s} · {tokens} tokens · {total time} · {time to first token}`. Timings are measured client-side; the token count comes from a `\x1e`-delimited trailer the `/api/chat` route appends (it counts per-token deltas, exact for local servers that stream one token per chunk).
- **Edit a reply**: hover an assistant message and click the pencil to edit its raw Markdown in place (Save/Esc-to-cancel). Since the conversation is persisted and fed back as context, edits let you curate what the model sees on later turns. Editing clears that message's stats footer.
- **Edit / regenerate from a message**: hover one of *your* messages for two actions: the **pencil** edits it and reruns the conversation from that point, and the **refresh** regenerates the reply from there unchanged (drops the old reply and anything after it). Both work on any user message, not just the last.
- **Multiple conversations**: the **chats icon** in the header switches the widget to a list of saved conversations (newest first); click one to open it, the **+** to start a new chat, or the **×** to delete one. Conversations are auto-titled from their first message and can be renamed inline (in the header or the list); an empty name reverts to auto-titling.
- **Send**: `Enter` sends, `Shift+Enter` inserts a newline. The composer **auto-grows** with multi-line input up to a cap (~160px), then scrolls.

## Dashboard lookup

The **database icon** (behind the **+** by the send box) toggles "answer using my dashboard data". The dashboard snapshot is **not** injected into the prompt; the model reads it on demand through tools:

- The client gathers one text entry per data-bearing widget on the active dashboard (`gatherWidgetEntries` in [`lib/dashboardContext.ts`](../../lib/dashboardContext.ts)): the full Notepad history plus Text, Weather, Calendar, F1, Feed, Reddit, YouTube, arXiv, HF Daily, and Tracker snapshots.
- The entries ship with each request, but only a one-line **roster** (id, title, type, size) enters the model's context, inside the `read_widget` tool description. The texts stay server-side until a tool reads them, so large dashboards no longer blow up the context window.
- `read_widget(id, find?, page?)`: reads one widget's content. Long content comes back in ~6k-char parts; `find="keywords"` jumps to matching sections, `page=N` reads sequentially.
- `search_dashboard(query)`: keyword search across all widgets at once (phrase first, then individual terms; up to 3 merged context windows per widget, ~3000 chars total), for when the model does not know which widget holds the answer.

Tool activity shows as short progress notes in the thinking trail. Widget data is the user's own, so it is **not** a citeable source (no `[n]` entries).

**Per-widget checkboxes**: settings lists every data-bearing widget instance on the active dashboard under *Dashboard widgets the model may read* (built by `listDashboardWidgets()`, names only, no fetching). Unchecking one excludes it before any gathering happens. Saving settings invalidates the cached gather.

While the mode is on, a subtitle reports `dashboard lookup on · N widgets · ~Xk chars readable`, and the **+** tray gains an **eye** (an overlay showing the exact system message plus the data readable through tools) and a **refresh** (re-gathers). The gather happens when the toggle turns on and is cached for the session.

## Lookup toggles (the + tray)

The **+** button by the send box reveals the data-source toggles. An active toggle shows as a filled pill, and the **+** itself stays highlighted while the tray is closed if any source is on:

- **Database**: dashboard lookup (above)
- **Library**: Kiwix lookup
- **Layers**: Anytype lookup
- **Calendar**: calendar read/write

Clicking an unconfigured Kiwix/Anytype toggle opens settings instead; the calendar toggle stays inert until a configured Calendar widget exists on the dashboard.

## Kiwix and Anytype lookup

Both hand the model search tools so it can ground answers in a source it actually reads (agentic RAG), citing what it used.

**Kiwix**: searches the user's offline Kiwix library. Settings take only the server URL; lookups search **every book on the server at once** (Wikipedia, WikiHow, anything installed), so adding books widens the search automatically. The **Check server** button lists the books found, as a status line. Tools: `search_kiwix` (keyword search) and `get_article` (read a result).

**Anytype**: searches the user's own Anytype notes. Set it up in settings: enter the local API URL (default `http://127.0.0.1:31009`), **Pair with Anytype** (a 4-digit code appears in the desktop app), then pick a space. The tools call [`lib/anytype.ts`](../../lib/anytype.ts) directly:

- `search_anytype`: full-text search; a multi-word query that finds nothing is retried as an AND of its terms (so "2026 journal" finds "Journal (2026)").
- `read_anytype_object`: reads a note's markdown body. Long notes come back in ~6k-char parts; the model can pass `find="keyword"` to jump to relevant sections or `page=N` to read sequentially.
- `summarize_anytype_object`: map-reduce digest of a whole long note (e.g. "summarize my journal"): the server splits it into ~6k chunks, summarizes each on its own model call, and returns the per-part summaries for the model to synthesize. Progress streams into the thinking trail.
- Search results and reads also carry each note's Created / Last modified dates and custom properties, so the model can answer "when did I write this" and questions about those fields.

The agentic loop in [`/api/chat`](../api.md#chat) runs up to 10 tool rounds. A model that searched but never opened a result gets bounced back to read one before answering (so it never answers from snippets); if the round cap is hit, a final tool-free turn is forced so the user always gets an answer. Every search result and read article gets a stable `[n]`; the **Sources** list under a reply shows what was actually read or cited inline, with clickable links.

## Calendar access

The calendar toggle gives the model read/write access to the dashboard's Calendar widget. The chat reuses that widget's CalDAV account (`getCalendarAccount()` returns the first configured Calendar widget's config on the active dashboard), so the credentials are stored once and relayed per request, like the Anytype connection. Tools:

- `list_calendar_events(start_date?, end_date?)`: events across the selected calendars, defaulting to the next 14 days.
- `create_calendar_event(title, start, end?, calendar?, location?, description?)`: writes only to writable calendars (read-only ones are excluded); the name matches loosely and falls back to the first writable.

The system prompt tells the model to create events only when explicitly asked, to confirm what it created, and to suggest a writable calendar when a create fails on a read-only one.

## Model residency (Ollama / LM Studio)

When the configured server is Ollama or LM Studio, a status **pill** in the header shows whether the model is loaded (`● loaded`, with an unload countdown on Ollama) or `○ unloaded`. Clicking it gives controls to set how long the model lingers after a reply (`5m` / `30m` / `1h`), **pin** it loaded (`∞`), or **unload now** to free VRAM. Backed by [`/api/model`](../api.md#model); hidden for servers with no controllable residency (llama.cpp, vLLM, hosted). The choice is stored in `config.keepAlive` and re-applied after each reply (Ollama `keep_alive`) or sent as `ttl` on the request (LM Studio).

## Characters & scoped memory

The **emoji/people icon** in the header opens the **Characters** panel: personas you can create, edit, and switch between. Each character has a name, emoji, **persona** (its own system prompt), a **focus**, and a private list of **memories** about you.

- The active character's persona and memories are injected into the system prompt, so it answers in role and recalls what it knows about you.
- **Scoped auto-memory**: a character only auto-remembers if it has a non-empty `focus`. After each reply, a quiet background call (non-streaming `/api/chat`, with reasoning disabled on local backends so the small token budget goes to the JSON output) reviews the exchange and saves *new* durable facts about you that match the focus, ignoring everything off-topic; an education coach keeps your studies and ignores your trip. Memories are capped (40) and editable by hand in the character editor.
- Each conversation is tied to a character (its emoji follows the chat). Picking a character retags the current chat if it is empty, otherwise starts a fresh one. Deleting a character reassigns its chats to the Assistant.
- The built-in **Assistant** is permanent, has no focus (so no memory), and uses the Settings system prompt, so default behaviour is unchanged.

## Why a server-side proxy

Requests go through [`/api/chat`](../api.md#chat) rather than directly from the
browser. This avoids CORS restrictions and HTTPS mixed-content blocking when the
dashboard is served over HTTPS but the model runs on plain `http://localhost`.
In local-only mode no API key is involved. (If the key field is re-enabled, the
key would be saved with the rest of the config in the database; move it to
`localStorage` first if that matters.)

This widget is not `digestable`.
