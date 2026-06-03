# Chat Widget

Chat with any model exposed over an **OpenAI-compatible** HTTP API — a locally
hosted server (Ollama, LM Studio, llama.cpp, vLLM, …) or a hosted provider.
Responses stream token-by-token and the conversation is saved.

## Storage Keys

| Key | Value |
|---|---|
| `chat-widget-{id}` | JSON: `{ config: { baseUrl, apiKey, model, system, useDashboard, maxTokens, length }, messages: [{ role, content }] }` |

- `baseUrl` — the API base, e.g. `http://localhost:11434/v1`. `/chat/completions` and `/models` are appended to it.
- `apiKey` — optional; sent as `Authorization: Bearer <key>`. Leave blank for local servers that don't require auth.
- `model` — the model id, e.g. `llama3.2`. The settings panel can **Load models** from `{baseUrl}/models` to populate a picker.
- `system` — optional system prompt prepended to every request.
- `useDashboard` — when `true`, a snapshot of your dashboard data is injected as context so the model can answer questions about it (see below).
- `maxTokens` — caps the reply length, sent upstream as `max_tokens`. `0` omits the field so the server uses its own default.
- `length` — response-style preset (`default` / `concise` / `balanced` / `detailed`). Each appends a brevity instruction to the system prompt and, when selected, fills `maxTokens` with a suggested cap (which can then be edited). `concise` ≈ 2-3 sentences (256 tokens), `balanced` ≈ a paragraph or two (768), `detailed` is thorough with no cap.
- `messages` — the full conversation, persisted after each completed turn.

## Configuration

Hover the widget and click the pencil to open settings. Quick-fill presets are
provided for Ollama (`:11434`), LM Studio (`:1234`), and llama.cpp (`:8080`).
Save is disabled until both an API URL and a model are set.

## Behaviour

- **Streaming** — replies stream in real-time via `POST /api/chat` with `stream: true`. The **Stop** button aborts the in-flight request and keeps whatever streamed so far.
- **Clear** — the reset icon (visible on hover once a conversation exists) wipes the history.
- **Send** — `Enter` sends, `Shift+Enter` inserts a newline.

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
session); the **refresh** button in the status bar re-gathers it, and the **eye**
button opens an overlay showing the exact text that gets injected as the
`<dashboard>` block, so you can see precisely what the model was fed. Larger
dashboards produce more context — keep your local model's context window in
mind. Reader and Chess widgets are not included (no useful text).

## Why a server-side proxy

Requests go through [`/api/chat`](../api.md#chat) rather than directly from the
browser. This avoids CORS restrictions and HTTPS mixed-content blocking when the
dashboard is served over HTTPS but the model runs on plain `http://localhost`.
The API key is forwarded per-request and never stored server-side.

This widget is not `digestable`.
