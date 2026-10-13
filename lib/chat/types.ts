// Shared types, defaults and small pure helpers for the Chat widget.

export type Role = "user" | "assistant";
export type WriteMode = "confirm" | "auto";
export type MsgStats = { tps: number; tokens: number; total: number; ttft: number };
export type Source = { n: number; title: string; url: string; cited?: boolean };
// A write the model wants to make, awaiting the user's click. Modern shape is
// kind/summary/detail/payload; proposals persisted before the generic form
// carry calendar fields at the top level (kind absent = calendar-create).
export type ProposalKind = "calendar-create" | "calendar-delete" | "anytype-create" | "anytype-append";
export type Proposal = {
  kind?: ProposalKind;
  summary?: string;
  detail?: string;
  payload?: Record<string, unknown>;
  // legacy calendar-create fields
  title?: string; start?: string; end?: string; location?: string; description?: string;
  calendarName?: string; calendarUrl?: string;
  status: "pending" | "added" | "dismissed" | "failed";
};
// A write the model already executed (auto mode), shown as a done-chip.
export type ActionChip = { kind: ProposalKind; summary: string; detail?: string };
export type NormalizedProposal = { kind: ProposalKind; summary: string; detail: string; payload: Record<string, unknown> };

// One canonical view over both proposal generations.
export function normalizeProposal(pr: Proposal): NormalizedProposal {
  if (pr.kind && pr.payload) {
    return { kind: pr.kind, summary: pr.summary ?? "", detail: pr.detail ?? "", payload: pr.payload };
  }
  // Legacy calendar-create card.
  const when = (pr.start ?? "").replace("T", " ");
  return {
    kind: "calendar-create",
    summary: `Add "${pr.title ?? ""}"`,
    detail: [when, pr.calendarName].filter(Boolean).join(" · "),
    payload: {
      title: pr.title, start: pr.start, end: pr.end, location: pr.location,
      description: pr.description, calendarName: pr.calendarName, calendarUrl: pr.calendarUrl,
    },
  };
}

export type ChatMessage = { role: Role; content: string; at?: number; images?: string[]; memory?: string[]; proposals?: Proposal[]; actions?: ActionChip[]; stats?: MsgStats; sources?: Source[] };
// The full conversation shape of the legacy single-key format.
export type Conversation = { id: string; title: string; messages: ChatMessage[]; updatedAt: number; renamed?: boolean; characterId?: string };
// What the history list needs about a conversation, kept in the index key so
// the list renders without loading every conversation. `autoTitle` is the
// title derived from the first message (the placeholder when renaming, and
// the title again when a manual name is cleared).
export type ConvMeta = { id: string; title: string; autoTitle: string; count: number; updatedAt: number; renamed?: boolean; characterId?: string };

// A persona with its own system prompt and a private, scoped memory about the
// user. `focus` both shapes the memory and gates auto-capture: a character only
// auto-remembers when it has a focus (so the plain Assistant stays memory-less).
export type Character = { id: string; name: string; emoji: string; persona: string; focus: string; memories: string[] };

export const DEFAULT_CHARACTER_ID = "default";

export function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Auto-title a conversation from its first user message.
export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === "user")?.content.trim().replace(/\s+/g, " ");
  if (!first) return "New chat";
  return first.length > 40 ? first.slice(0, 40) + "…" : first;
}

export type Length = "default" | "concise" | "balanced" | "detailed";
// Reasoning-model thinking budget, sent as OpenAI `reasoning_effort`.
// "default" omits the field; "none" turns thinking off (fast).
export type Effort = "default" | "none" | "low" | "medium" | "high";
export const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: "default", label: "Auto" },
  { value: "none", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export type ChatConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  useDashboard: boolean;     // legacy (v1 master switch); superseded by per-widget dashboardWidgets
  // Data access per widget instance id: true = the model may read it. There is
  // no master switch; missing/false = off, so access is always an explicit
  // opt-in from the chat's overflow menu. A calendar widget's entry also
  // grants the calendar read/write tools.
  dashboardWidgets: Record<string, boolean>;
  sourcesVersion?: number; // 2 = per-widget model (no master toggle)
  maxTokens: number; // cap on response length; 0 = no limit (server default)
  length: Length;    // response-style preset: brevity instruction + suggested cap
  effort: Effort;    // reasoning-model thinking budget
  useKiwix: boolean;       // let the model search the Kiwix library via tools
  kiwixUrl: string;        // kiwix-serve base URL; lookups search ALL books on it
  kiwixSource: string;     // legacy single-book pin (no longer set by the UI)
  kiwixSourceTitle: string;
  useCalendar: boolean;    // legacy (v1); a calendar widget's dashboardWidgets entry now grants its tools
  useAnytype: boolean;     // let the model search the user's Anytype via tools
  anytypeUrl: string;      // Anytype local API base (default 127.0.0.1:31009)
  anytypeApiKey: string;   // paired Bearer token
  anytypeSpaceId: string;  // selected space
  anytypeSpaceName: string;
  // Write bridge (tools/anytype-bridge): unlocks creating/appending Anytype
  // notes with real blocks. Reads work without it.
  anytypeBridgeUrl: string;
  anytypeBridgeToken: string;
  // Per-capability write mode: "confirm" = the model proposes and the user
  // approves a card (default); "auto" = writes execute immediately.
  calendarWriteMode: WriteMode;
  anytypeWriteMode: WriteMode;
  // Ollama only: how long the model lingers in VRAM after a reply. "" = leave
  // it to Ollama's default; "5m"/"30m"/"1h" = that duration; "-1" = stay loaded.
  keepAlive: string;
};

// Always-on identity so the assistant knows who and where it is, even when the
// dashboard-data toggle is off (otherwise the underlying model answers as its
// generic self).
export const BASE_IDENTITY =
  "You are the assistant built into oldenbyte — a personal dashboard the user self-hosts. " +
  "You live in a Chat widget alongside their other widgets: notes, RSS/Reddit/YouTube/arXiv/Hugging Face feeds, an F1 panel, an activity tracker, a reader, and more. " +
  "Your purpose is to be a helpful, grounded companion on this dashboard — answer questions, think things through, and, when the user enables it, help them make sense of their own dashboard data (their notes and the feeds they follow). " +
  "Keep replies clear and to the point, and if you don't know something, say so rather than making it up.";

// Each style appends a brevity hint to the system prompt and suggests a token
// cap. The cap is just a starting point: the Max-tokens field can override it.
export const LENGTH_PRESETS: Record<Length, { label: string; cap: number; instruction: string }> = {
  default:  { label: "Default",  cap: 0,   instruction: "" },
  concise:  { label: "Concise",  cap: 256, instruction: "Answer concisely — usually 2-3 sentences. Skip preamble, caveats, and filler; give just the essentials." },
  balanced: { label: "Balanced", cap: 768, instruction: "Keep answers focused and reasonably brief — at most a paragraph or two." },
  detailed: { label: "Detailed", cap: 0,   instruction: "Give a thorough, well-structured answer with relevant detail and examples where helpful." },
};

// Seed the built-in Assistant (no focus → no auto-memory; its persona is the
// config's system prompt, preserving existing behavior).
export function defaultCharacter(persona: string): Character {
  return { id: DEFAULT_CHARACTER_ID, name: "Assistant", emoji: "🤖", persona, focus: "", memories: [] };
}

export const DEFAULT_CONFIG: ChatConfig = {
  baseUrl: "",
  apiKey: "",
  model: "",
  system: "",
  useDashboard: false,
  dashboardWidgets: {},
  maxTokens: 0,
  length: "default",
  effort: "default",
  useKiwix: false,
  kiwixUrl: "",
  kiwixSource: "",
  kiwixSourceTitle: "",
  useCalendar: false,
  useAnytype: false,
  anytypeUrl: "http://127.0.0.1:31009",
  anytypeApiKey: "",
  anytypeSpaceId: "",
  anytypeSpaceName: "",
  anytypeBridgeUrl: "",
  anytypeBridgeToken: "",
  calendarWriteMode: "confirm",
  anytypeWriteMode: "confirm",
  keepAlive: "",
};

// Common local OpenAI-compatible servers, shown as quick-fill hints.
export const PRESETS: { label: string; url: string }[] = [
  { label: "Ollama",    url: "http://localhost:11434/v1" },
  { label: "LM Studio", url: "http://localhost:1234/v1" },
  { label: "llama.cpp", url: "http://localhost:8080/v1" },
];
