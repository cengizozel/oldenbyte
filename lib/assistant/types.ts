// Shared types for the chat assistant's tool providers.
//
// A Provider bundles one integration (dashboard widgets, calendar, kiwix,
// anytype, later gmail…): the tool schemas it offers the model and the executor
// that runs them. The chat route builds the active providers from the request's
// configs and the agentic loop stays integration-agnostic — adding a new
// integration means adding one provider file and one registry entry.

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

// A search hit, normalized across sources: `ref` is what the model passes to the
// matching read tool (a url for Kiwix, an object id for Anytype); `link` is the
// clickable source shown in citations.
export type SearchHit = { title: string; ref: string; link: string; snippet: string; meta?: string };

// A write the model wants to make. In "confirm" mode it is delivered to the
// client via the stream trailer and only executed when the user approves the
// card; the payload is everything the executing API route needs EXCEPT
// credentials, which the client re-attaches from its own widget config at
// accept time (so tokens never sit in persisted chat history).
export type Proposal = {
  kind: "calendar-create" | "calendar-delete" | "anytype-create" | "anytype-append";
  summary: string;                    // one-line card title, e.g. `Add "Dentist"`
  detail?: string;                    // second line, e.g. `Fri 2026-07-10 14:00 · Personal`
  payload: Record<string, unknown>;
};

// A write that was executed immediately (auto mode); shown as a done-chip.
export type Action = { kind: Proposal["kind"]; summary: string; detail?: string };

export type ToolResult =
  | { kind: "search"; source: string; query: string; results: SearchHit[] }
  | { kind: "article"; title: string; link: string; text: string; meta?: string }
  // Info reads (dashboard/calendar): full text goes to the model, `note` in the trail.
  | { kind: "widget"; note: string; text: string }
  | { kind: "proposal"; note: string; text: string; proposal: Proposal }
  | { kind: "action"; note: string; text: string; action: Action }
  | { kind: "message"; text: string };

export type ProviderCtx = { userId: string; signal: AbortSignal };

export interface Provider {
  key: string;
  // Optional async warm-up before tools are read (e.g. fetch a style profile).
  init?(signal: AbortSignal): Promise<void>;
  tools(): ToolSpec[];
  // Return null when the tool name is not this provider's — the loop asks each
  // provider in turn.
  run(name: string, args: Record<string, unknown>, ctx: ProviderCtx): Promise<ToolResult | null>;
}

export type WriteMode = "confirm" | "auto";
