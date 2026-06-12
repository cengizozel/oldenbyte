"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bot, Pencil, Send, Square, Check, X, RotateCcw, RefreshCw, Loader, Database, Eye, MessageSquare, Plus, ChevronRight, Library, Power, Layers, Users, Trash2, CalendarDays } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { gatherWidgetEntries, listDashboardWidgets, getCalendarAccount, type WidgetEntry, type WidgetRosterItem, type CalendarAccount } from "@/lib/dashboardContext";
import { SettingsInput, SettingsSelect, SettingsTextarea } from "./ui/Field";
import Markdown from "./Markdown";

type Role = "user" | "assistant";
type MsgStats = { tps: number; tokens: number; total: number; ttft: number };
type Source = { n: number; title: string; url: string; cited?: boolean };
type ChatMessage = { role: Role; content: string; stats?: MsgStats; sources?: Source[] };
type Conversation = { id: string; title: string; messages: ChatMessage[]; updatedAt: number; renamed?: boolean; characterId?: string };

// A persona with its own system prompt and a private, scoped memory about the
// user. `focus` both shapes the memory and gates auto-capture: a character only
// auto-remembers when it has a focus (so the plain Assistant stays memory-less).
type Character = { id: string; name: string; emoji: string; persona: string; focus: string; memories: string[] };

const DEFAULT_CHARACTER_ID = "default";

function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Auto-title a conversation from its first user message.
function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === "user")?.content.trim().replace(/\s+/g, " ");
  if (!first) return "New chat";
  return first.length > 40 ? first.slice(0, 40) + "…" : first;
}

// Compact countdown for the model-residency pill: 45s, 4m, 1h12m.
function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${mm}m` : `${h}h`;
}

function timeAgo(ms: number): string {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
}

// Reasoning models (qwen3, deepseek-r1, …) stream their chain-of-thought inline
// as <think>…</think>. Split it out so it can be shown in a collapsible block
// rather than mixed into the answer. Handles <thinking> too, and an unclosed
// trailing <think> mid-stream.
type ThinkSeg = { type: "text" | "think"; content: string; open?: boolean };
function splitThinking(raw: string): ThinkSeg[] {
  const content = raw.replace(/<thinking>/gi, "<think>").replace(/<\/thinking>/gi, "</think>");
  const lower = content.toLowerCase();
  const segs: ThinkSeg[] = [];
  let i = 0;
  while (i < content.length) {
    const start = lower.indexOf("<think>", i);
    if (start === -1) { segs.push({ type: "text", content: content.slice(i) }); break; }
    if (start > i) segs.push({ type: "text", content: content.slice(i, start) });
    const afterOpen = start + 7;
    const end = lower.indexOf("</think>", afterOpen);
    if (end === -1) { segs.push({ type: "think", content: content.slice(afterOpen), open: true }); break; }
    segs.push({ type: "think", content: content.slice(afterOpen, end) });
    i = end + 8;
  }
  return segs;
}

// Collapsible reasoning block — auto-expands while the model is actively
// thinking, then collapses once the answer starts (unless the user toggled it).
function ThinkBlock({ content, active, labelClass }: { content: string; active: boolean; labelClass: string }) {
  const [open, setOpen] = useState(active);
  const toggled = useRef(false);
  useEffect(() => { if (!toggled.current) setOpen(active); }, [active]);
  if (!content.trim() && !active) return null;
  return (
    <div className="my-1">
      <button
        onClick={() => { toggled.current = true; setOpen(o => !o); }}
        className={`flex items-center gap-1 text-[11px] ${labelClass} opacity-50 hover:opacity-80`}
      >
        <ChevronRight size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {active ? "Thinking…" : "Thinking"}
      </button>
      {open && (
        <div className="mt-1 ml-1 pl-3 border-l-2 border-black/15 dark:border-white/20 text-[12px] opacity-60">
          <Markdown text={content} />
        </div>
      )}
    </div>
  );
}

function renderAssistant(content: string, inProgress: boolean, labelClass: string, sources?: Source[]) {
  // Map [n] → article so the Markdown renderer makes citation chips clickable.
  const cites = Object.fromEntries((sources ?? []).map(s => [s.n, { url: s.url, title: s.title }]));
  return splitThinking(content).map((seg, i) =>
    seg.type === "think"
      ? <ThinkBlock key={i} content={seg.content} active={!!seg.open && inProgress} labelClass={labelClass} />
      : (seg.content.trim() ? <Markdown key={i} text={seg.content} cites={cites} /> : null)
  );
}

// "Sources" disclosure under a reply — the articles the model actually cited.
function SourcesList({ sources, labelClass, textClass }: { sources: Source[]; labelClass: string; textClass: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 text-[11px] ${labelClass} opacity-60 hover:opacity-90`}
      >
        <ChevronRight size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {sources.length} source{sources.length === 1 ? "" : "s"}
      </button>
      {open && (
        <ol className="mt-1 ml-1 pl-3 border-l-2 border-black/15 dark:border-white/20 flex flex-col gap-0.5">
          {sources.map(s => (
            <li key={s.n} className={`text-[11px] ${textClass} opacity-75`}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">
                <span className="opacity-50">[{s.n}]</span> <span className="underline underline-offset-2">{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Length = "default" | "concise" | "balanced" | "detailed";
// Reasoning-model thinking budget, sent as OpenAI `reasoning_effort`.
// "default" omits the field; "none" turns thinking off (fast).
type Effort = "default" | "none" | "low" | "medium" | "high";
const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "none", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

type ChatConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  useDashboard: boolean;
  // Which widgets the dashboard lookup may read, by instance id. Missing key =
  // included, so newly added widgets are searchable by default.
  dashboardWidgets: Record<string, boolean>;
  maxTokens: number; // cap on response length; 0 = no limit (server default)
  length: Length;    // response-style preset: brevity instruction + suggested cap
  effort: Effort;    // reasoning-model thinking budget
  useKiwix: boolean;       // let the model search the Kiwix library via tools
  kiwixUrl: string;        // kiwix-serve base URL; lookups search ALL books on it
  kiwixSource: string;     // legacy single-book pin (no longer set by the UI)
  kiwixSourceTitle: string;
  useCalendar: boolean;    // let the model read/write the dashboard Calendar widget's CalDAV account
  useAnytype: boolean;     // let the model search the user's Anytype via tools
  anytypeUrl: string;      // Anytype local API base (default 127.0.0.1:31009)
  anytypeApiKey: string;   // paired Bearer token
  anytypeSpaceId: string;  // selected space
  anytypeSpaceName: string;
  // Ollama only: how long the model lingers in VRAM after a reply. "" = leave
  // it to Ollama's default; "5m"/"30m"/"1h" = that duration; "-1" = stay loaded.
  keepAlive: string;
};

// Always-on identity so the assistant knows who and where it is, even when the
// dashboard-data toggle is off (otherwise the underlying model answers as its
// generic self).
const BASE_IDENTITY =
  "You are the assistant built into oldenbyte — a personal dashboard the user self-hosts. " +
  "You live in a Chat widget alongside their other widgets: notes, RSS/Reddit/YouTube/arXiv/Hugging Face feeds, an F1 panel, an activity tracker, a reader, and more. " +
  "Your purpose is to be a helpful, grounded companion on this dashboard — answer questions, think things through, and, when the user enables it, help them make sense of their own dashboard data (their notes and the feeds they follow). " +
  "Keep replies clear and to the point, and if you don't know something, say so rather than making it up.";

// Each style appends a brevity hint to the system prompt and suggests a token
// cap. The cap is just a starting point — the Max-tokens field can override it.
const LENGTH_PRESETS: Record<Length, { label: string; cap: number; instruction: string }> = {
  default:  { label: "Default",  cap: 0,   instruction: "" },
  concise:  { label: "Concise",  cap: 256, instruction: "Answer concisely — usually 2-3 sentences. Skip preamble, caveats, and filler; give just the essentials." },
  balanced: { label: "Balanced", cap: 768, instruction: "Keep answers focused and reasonably brief — at most a paragraph or two." },
  detailed: { label: "Detailed", cap: 0,   instruction: "Give a thorough, well-structured answer with relevant detail and examples where helpful." },
};

type ChatState = {
  config: ChatConfig;
  conversations?: Conversation[];
  activeId?: string;
  characters?: Character[];
  activeCharacterId?: string;
  messages?: ChatMessage[]; // legacy single-conversation format
};

// Seed the built-in Assistant (no focus → no auto-memory; its persona is the
// config's system prompt, preserving existing behavior).
function defaultCharacter(persona: string): Character {
  return { id: DEFAULT_CHARACTER_ID, name: "Assistant", emoji: "🤖", persona, focus: "", memories: [] };
}

const DEFAULT_CONFIG: ChatConfig = {
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
  keepAlive: "",
};

// Common local OpenAI-compatible servers, shown as quick-fill hints.
const PRESETS: { label: string; url: string }[] = [
  { label: "Ollama",    url: "http://localhost:11434/v1" },
  { label: "LM Studio", url: "http://localhost:1234/v1" },
  { label: "llama.cpp", url: "http://localhost:8080/v1" },
];

export default function ChatWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color];
  const storageKey = `chat-widget-${widget.id}`;

  const [config, setConfig] = useState<ChatConfig>(DEFAULT_CONFIG);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Saved conversations; `messages` above is the working copy of the active one.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const activeIdRef = useRef("");
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Characters (personas + scoped memory). The active one drives the system
  // prompt for new chats; each conversation remembers which character it used.
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState(DEFAULT_CHARACTER_ID);
  const charactersRef = useRef<Character[]>([]);
  const activeCharacterIdRef = useRef(DEFAULT_CHARACTER_ID);
  // Refs so character-only saves can read the latest config/conversations.
  const configRef = useRef<ChatConfig>(DEFAULT_CONFIG);
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => { charactersRef.current = characters; }, [characters]);
  useEffect(() => { activeCharacterIdRef.current = activeCharacterId; }, [activeCharacterId]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { configRef.current = config; }, [config]);
  // The character driving the current chat (its conversation's, falling back to active).
  const activeConvCharId = conversations.find(cv => cv.id === activeId)?.characterId ?? activeCharacterId;
  const activeCharacter = characters.find(ch => ch.id === activeConvCharId) ?? characters.find(ch => ch.id === DEFAULT_CHARACTER_ID);
  const [charactersOpen, setCharactersOpen] = useState(false);   // characters list overlay
  const [editingCharId, setEditingCharId] = useState<string | null>(null); // editor overlay (null = closed)
  const [charDraft, setCharDraft] = useState<Character | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<ChatConfig>(DEFAULT_CONFIG);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [kiwixSources, setKiwixSources] = useState<{ title: string; id: string }[]>([]);
  const [loadingKiwix, setLoadingKiwix] = useState(false);
  const [kiwixError, setKiwixError] = useState("");

  // Anytype pairing (in chat settings) — its own connection, like the Kiwix one.
  const [anytypeSpaces, setAnytypeSpaces] = useState<{ id: string; name: string }[]>([]);
  const [anytypePairing, setAnytypePairing] = useState<"idle" | "awaiting-code">("idle");
  const [anytypeChallengeId, setAnytypeChallengeId] = useState("");
  const [anytypeCode, setAnytypeCode] = useState("");
  const [anytypeBusy, setAnytypeBusy] = useState(false);
  const [anytypeError, setAnytypeError] = useState("");

  // Dashboard data — gathered per-widget when `config.useDashboard` is on and
  // shipped with each request for the model's read_widget/search_dashboard
  // tools (only a small roster enters the model's context). Cached so we don't
  // re-fetch every message.
  const [ctx, setCtx] = useState<WidgetEntry[] | null>(null);
  const [gathering, setGathering] = useState(false);
  const [showContext, setShowContext] = useState(false);
  // Roster for the settings checkbox list (no content fetching).
  const [roster, setRoster] = useState<WidgetRosterItem[]>([]);
  // CalDAV account from the dashboard's Calendar widget (null = none configured).
  const [calAccount, setCalAccount] = useState<CalendarAccount | null>(null);
  useEffect(() => { getCalendarAccount().then(setCalAccount).catch(() => {}); }, []);
  const ctxChars = ctx ? ctx.reduce((n, e) => n + e.text.length, 0) : 0;
  // Dashboard tools (data toggle / view / refresh) tuck behind a "+" by the send button.
  const [toolsOpen, setToolsOpen] = useState(false);

  // Model residency. `backend` is null until we know what this server is: null =
  // not a controllable backend (control hidden), "ollama"/"lmstudio" = supported.
  // `models` carries residency (expiresAt is Ollama-only; loaded is the flag).
  // `nowMs` ticks each second so Ollama's countdown stays live between polls.
  type Backend = "ollama" | "lmstudio" | null;
  const [power, setPower] = useState<{ backend: Backend; models: { name: string; expiresAt: string | null; loaded: boolean }[] }>({ backend: null, models: [] });
  const [nowMs, setNowMs] = useState(0);
  const [powerOpen, setPowerOpen] = useState(false);
  const [powerBusy, setPowerBusy] = useState(false);
  // Inline rename of the active conversation's title in the header.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // Inline rename of a row in the Chats list.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Inline editing of an assistant reply (the persisted conversation is fed back
  // as context, so edits let you curate it).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  // Composer auto-grows with its content up to a cap (then scrolls).
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Follow the stream only while the user is near the bottom; if they scroll up
  // (e.g. to read while it's still thinking), stop auto-scrolling.
  const atBottomRef = useRef(true);
  function onMessagesScroll() {
    const el = scrollRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }
  const abortRef = useRef<AbortController | null>(null);

  // Live status timing while a response streams.
  const timingRef = useRef<{ start: number; first: number | null }>({ start: 0, first: null });
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!streaming) { setElapsedMs(0); return; }
    const tick = () => setElapsedMs(performance.now() - timingRef.current.start);
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [streaming]);

  const refreshContext = useCallback(async () => {
    setGathering(true);
    try {
      const excluded = configRef.current.dashboardWidgets;
      const result = await gatherWidgetEntries(id => excluded[id] !== false);
      setCtx(result);
      return result;
    } catch {
      const empty: WidgetEntry[] = [];
      setCtx(empty);
      return empty;
    } finally {
      setGathering(false);
    }
  }, []);

  // Load persisted config + conversations (migrating the old single-chat format)
  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      let convs: Conversation[] = [];
      let active = "";
      let chars: Character[] = [];
      let activeChar = DEFAULT_CHARACTER_ID;
      let cfg: ChatConfig = DEFAULT_CONFIG;
      if (saved) {
        try {
          const parsed: ChatState = JSON.parse(saved);
          cfg = { ...DEFAULT_CONFIG, ...parsed.config };
          setConfig(cfg);
          configRef.current = cfg; // before refreshContext, so the gather respects saved checkboxes
          if (parsed.conversations?.length) {
            convs = parsed.conversations;
            active = parsed.activeId && convs.some(c => c.id === parsed.activeId) ? parsed.activeId : convs[0].id;
          } else {
            // Legacy: a single { messages } — wrap it as one conversation.
            const legacy = parsed.messages ?? [];
            const id = newId();
            convs = [{ id, title: titleFrom(legacy), messages: legacy, updatedAt: Date.now() }];
            active = id;
          }
          chars = parsed.characters ?? [];
          activeChar = parsed.activeCharacterId ?? DEFAULT_CHARACTER_ID;
          if (parsed.config?.useDashboard) refreshContext();
        } catch {}
      }
      if (!convs.length) {
        const id = newId();
        convs = [{ id, title: "New chat", messages: [], updatedAt: Date.now() }];
        active = id;
      }
      // Ensure a default character exists (its persona = the config system prompt).
      if (!chars.some(ch => ch.id === DEFAULT_CHARACTER_ID)) chars = [defaultCharacter(cfg.system), ...chars];
      if (!chars.some(ch => ch.id === activeChar)) activeChar = DEFAULT_CHARACTER_ID;
      setCharacters(chars);
      charactersRef.current = chars;
      setActiveCharacterId(activeChar);
      activeCharacterIdRef.current = activeChar;
      setConversations(convs);
      conversationsRef.current = convs;
      setActiveId(active);
      activeIdRef.current = active;
      configRef.current = cfg;
      setMessages(convs.find(c => c.id === active)?.messages ?? []);
      setLoaded(true);
    });
  }, [storageKey, refreshContext]);

  // Persist config + all conversations, syncing the active conversation's
  // messages from the working copy. (Signature unchanged so existing callers —
  // send, edit, clear, settings — keep working.)
  const persist = useCallback((cfg: ChatConfig, msgs: ChatMessage[]) => {
    const active = activeIdRef.current;
    setConversations(prev => {
      let found = false;
      const merged = prev.map(cv => {
        if (cv.id !== active) return cv;
        found = true;
        return { ...cv, messages: msgs, title: cv.renamed ? cv.title : titleFrom(msgs), updatedAt: Date.now() };
      });
      if (!found) merged.push({ id: active || newId(), title: titleFrom(msgs), messages: msgs, updatedAt: Date.now(), characterId: activeCharacterIdRef.current });
      conversationsRef.current = merged;
      storage.setItem(storageKey, JSON.stringify({ config: cfg, conversations: merged, activeId: active || merged[merged.length - 1].id, characters: charactersRef.current, activeCharacterId: activeCharacterIdRef.current }));
      return merged;
    });
  }, [storageKey]);

  // Write the current conversation list to storage as-is.
  const persistConversations = useCallback((cfg: ChatConfig, convs: Conversation[], active: string) => {
    conversationsRef.current = convs;
    storage.setItem(storageKey, JSON.stringify({ config: cfg, conversations: convs, activeId: active, characters: charactersRef.current, activeCharacterId: activeCharacterIdRef.current }));
  }, [storageKey]);

  // Save when only the characters / active character changed (uses latest refs
  // for everything else so it never clobbers in-flight conversation state).
  const persistCharacters = useCallback((chars: Character[], activeChar: string) => {
    charactersRef.current = chars;
    activeCharacterIdRef.current = activeChar;
    storage.setItem(storageKey, JSON.stringify({ config: configRef.current, conversations: conversationsRef.current, activeId: activeIdRef.current, characters: chars, activeCharacterId: activeChar }));
  }, [storageKey]);

  // Keep the view pinned to the latest message — but only if the user hasn't
  // scrolled up to read earlier content.
  useEffect(() => {
    if (atBottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Leaving the settings panel remounts the message list at the top — snap back
  // to the latest message.
  useEffect(() => {
    if (settingsOpen) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) { el.scrollTo({ top: el.scrollHeight }); atBottomRef.current = true; }
    });
  }, [settingsOpen]);

  // Abort any in-flight stream on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  // Grow the composer to fit its text, up to a max height (then it scrolls).
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const configured = Boolean(config.baseUrl && config.model);

  // ── Model residency (Ollama / LM Studio) ────────────────────────────────────
  // Match the configured model to a residency entry. Servers tag names (Ollama
  // "llama3.2:latest"; LM Studio "publisher/model") so accept base/prefix matches.
  const base = (s: string) => s.split(":")[0];
  const loadedEntry = power.models.find(
    m => m.name === config.model || base(m.name) === base(config.model) || m.name.startsWith(config.model)
  );
  const backend = power.backend;
  const powerCapable = backend !== null;
  const isLoaded = !!loadedEntry?.loaded;
  // Only Ollama reports an unload time, so the countdown is Ollama-only.
  const remainingMs = loadedEntry?.expiresAt ? new Date(loadedEntry.expiresAt).getTime() - (nowMs || Date.now()) : 0;
  const hasCountdown = backend === "ollama" && isLoaded && remainingMs > 0;
  // keep_alive -1 pushes expires_at far into the future — treat >30 days as pinned.
  const pinned = (backend === "ollama" && remainingMs > 1000 * 60 * 60 * 24 * 30)
    || (backend === "lmstudio" && config.keepAlive === "-1" && isLoaded);

  // Map a keep-alive preset to LM Studio's ttl (seconds). "-1"/"" → no ttl.
  const ttlSeconds = (v: string) => ({ "5m": 300, "30m": 1800, "1h": 3600 } as Record<string, number>)[v] ?? 0;

  const pollPower = useCallback(async () => {
    if (!config.baseUrl || !config.model) { setPower({ backend: null, models: [] }); return; }
    try {
      const res = await fetch(`/api/model?baseUrl=${encodeURIComponent(config.baseUrl)}`);
      const data = await res.json();
      setPower({ backend: data.backend ?? null, models: data.models ?? [] });
    } catch {
      setPower({ backend: null, models: [] });
    }
  }, [config.baseUrl, config.model]);

  // Poll residency every 5s while configured.
  useEffect(() => {
    if (!configured) { setPower({ backend: null, models: [] }); return; }
    pollPower();
    const id = setInterval(pollPower, 5000);
    return () => clearInterval(id);
  }, [configured, pollPower]);

  // Tick the countdown once a second while a backend is detected (Ollama only
  // shows it, but the cheap tick is harmless either way).
  useEffect(() => {
    if (!powerCapable) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [powerCapable]);

  // Low-level residency change. Ollama: keep_alive ("5m" | -1 | 0). LM Studio:
  // action "pin" (manual load) | "unload".
  const postPower = useCallback(async (body: Record<string, unknown>) => {
    try {
      await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: config.baseUrl, model: config.model, backend: power.backend, ...body }),
      });
    } catch {}
  }, [config.baseUrl, config.model, power.backend]);

  // Choose how long the model lingers. Persists the preference (Ollama re-applies
  // it after each reply; LM Studio sends it as ttl on each request). Picking a
  // duration never force-loads an idle model — only an explicit pin (∞) does.
  async function chooseLinger(value: string, opts?: { load?: boolean }) {
    const next = { ...config, keepAlive: value };
    setConfig(next);
    persist(next, messages);
    setPowerBusy(true);
    if (backend === "ollama") {
      if (opts?.load || isLoaded) await postPower({ keepAlive: value === "" ? "5m" : value });
    } else if (backend === "lmstudio") {
      // ∞ pins via a manual load; durations just take effect on the next message.
      if (value === "-1") await postPower({ action: "pin" });
    }
    await pollPower();
    setPowerBusy(false);
  }

  // Evict the model from VRAM right now. One-shot — doesn't change the linger
  // preference, so the next message reloads under whatever you've chosen.
  async function unloadNow() {
    setPowerBusy(true);
    if (backend === "ollama") await postPower({ keepAlive: 0 });
    else if (backend === "lmstudio") await postPower({ action: "unload" });
    await pollPower();
    setPowerBusy(false);
    setPowerOpen(false);
  }

  async function fetchModels(cfg: ChatConfig) {
    if (!cfg.baseUrl) {
      setModelsError("Enter an API URL first.");
      return;
    }
    setLoadingModels(true);
    setModelsError("");
    try {
      const params = new URLSearchParams({ baseUrl: cfg.baseUrl });
      if (cfg.apiKey) params.set("apiKey", cfg.apiKey);
      const res = await fetch(`/api/chat?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to list models");
      const list: string[] = data.models ?? [];
      setModels(list);
      if (list.length === 0) setModelsError("No models reported by this server.");
      // Keep the configured model if it's still offered; otherwise fall back to the first.
      else setDraft(d => ({ ...d, model: list.includes(d.model) ? d.model : list[0] }));
    } catch (err) {
      setModels([]);
      setModelsError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoadingModels(false);
    }
  }

  // List the server's books for the settings status line. Lookups always search
  // every book, so there is nothing to pick here anymore.
  async function loadKiwixSources(kiwixUrl: string) {
    if (!kiwixUrl.startsWith("http")) return;
    setLoadingKiwix(true);
    setKiwixError("");
    setKiwixSources([]);
    try {
      const res = await fetch(`/api/kiwix?baseUrl=${encodeURIComponent(kiwixUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKiwixSources(data.sources ?? []);
    } catch (e) {
      setKiwixError(String((e as Error).message ?? e));
    } finally {
      setLoadingKiwix(false);
    }
  }

  // ── Anytype pairing (mirrors the AnytypeWidget flow) ───────────────────────
  async function startAnytypePairing() {
    setAnytypeError("");
    if (!draft.anytypeUrl.startsWith("http")) { setAnytypeError("Enter the Anytype API URL (http://…)."); return; }
    setAnytypeBusy(true);
    try {
      const res = await fetch("/api/anytype", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "challenge", baseUrl: draft.anytypeUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnytypeChallengeId(data.challengeId);
      setAnytypePairing("awaiting-code");
      setAnytypeCode("");
    } catch (e) {
      setAnytypeError(`Could not reach Anytype: ${String((e as Error).message ?? e)}. Is the desktop app running?`);
    } finally {
      setAnytypeBusy(false);
    }
  }

  async function confirmAnytypeCode() {
    setAnytypeError("");
    if (!anytypeCode.trim()) { setAnytypeError("Enter the 4-digit code from Anytype."); return; }
    setAnytypeBusy(true);
    try {
      const res = await fetch("/api/anytype", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "key", baseUrl: draft.anytypeUrl, challengeId: anytypeChallengeId, code: anytypeCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraft((d) => ({ ...d, anytypeApiKey: data.apiKey }));
      setAnytypePairing("idle");
      await loadAnytypeSpaces(draft.anytypeUrl, data.apiKey, draft.anytypeSpaceId);
    } catch (e) {
      setAnytypeError(`Pairing failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setAnytypeBusy(false);
    }
  }

  async function loadAnytypeSpaces(baseUrl: string, apiKey: string, preferred: string) {
    if (!baseUrl.startsWith("http") || !apiKey) return;
    setAnytypeBusy(true);
    setAnytypeSpaces([]);
    try {
      const res = await fetch(`/api/anytype?op=spaces&baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const list: { id: string; name: string }[] = data.spaces ?? [];
      setAnytypeSpaces(list);
      const pick = list.find((s) => s.id === preferred) ?? list[0];
      if (pick) setDraft((d) => ({ ...d, anytypeSpaceId: pick.id, anytypeSpaceName: pick.name }));
    } catch (e) {
      setAnytypeError(`Could not load spaces: ${String((e as Error).message ?? e)}`);
    } finally {
      setAnytypeBusy(false);
    }
  }

  function openSettings() {
    setDraft(config);
    setModels([]);
    setModelsError("");
    setKiwixSources([]);
    setKiwixError("");
    setAnytypeSpaces([]);
    setAnytypePairing("idle");
    setAnytypeError("");
    setSettingsOpen(true);
    // Auto-load the model list so the dropdown is ready (keeps the chosen model).
    if (config.baseUrl) fetchModels(config);
    if (config.kiwixUrl) loadKiwixSources(config.kiwixUrl);
    if (config.anytypeUrl && config.anytypeApiKey) loadAnytypeSpaces(config.anytypeUrl, config.anytypeApiKey, config.anytypeSpaceId);
    // Roster for the dashboard checkbox list (names only, no data fetching).
    listDashboardWidgets().then(setRoster).catch(() => setRoster([]));
  }

  function saveSettings() {
    const next: ChatConfig = {
      ...draft,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      apiKey: "", // local-only for now; no key is stored (re-enable the field to use hosted providers)
      maxTokens: Math.max(0, Math.floor(draft.maxTokens || 0)),
      kiwixUrl: draft.kiwixUrl.trim(),
    };
    setConfig(next);
    configRef.current = next;
    persist(next, messages);
    setSettingsOpen(false);
    // Checkbox changes invalidate the cached gather; rebuild if lookup is on.
    setCtx(null);
    if (next.useDashboard) refreshContext();
  }

  function clearChat() {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages([]);
    setError("");
    persist(config, []);
  }

  function toggleDashboard() {
    const next = { ...config, useDashboard: !config.useDashboard };
    setConfig(next);
    persist(next, messages);
    if (next.useDashboard && !ctx) refreshContext();
  }

  function toggleKiwix() {
    const next = { ...config, useKiwix: !config.useKiwix };
    setConfig(next);
    persist(next, messages);
  }

  function toggleCalendar() {
    const next = { ...config, useCalendar: !config.useCalendar };
    setConfig(next);
    persist(next, messages);
  }

  function toggleAnytype() {
    const next = { ...config, useAnytype: !config.useAnytype };
    setConfig(next);
    persist(next, messages);
  }

  function startEdit(i: number) {
    setEditingIndex(i);
    setEditDraft(messages[i].content);
  }
  function cancelEdit() {
    setEditingIndex(null);
    setEditDraft("");
  }
  function saveEdit() {
    if (editingIndex === null) return;
    const i = editingIndex;
    const text = editDraft;
    if (messages[i].role === "user") {
      // Editing a past message rewinds the conversation: keep everything up to
      // it (with the new text), drop the rest, and regenerate from that point.
      if (streaming || !configured || !text.trim()) return;
      cancelEdit();
      setError("");
      generate([...messages.slice(0, i), { role: "user", content: text }]);
      return;
    }
    // Editing an assistant reply just rewrites its text in place.
    // Drop stats — the token count/timing no longer describe the edited text.
    const next = messages.map((m, idx) =>
      idx === i ? { ...m, content: text, stats: undefined } : m
    );
    setMessages(next);
    persist(config, next);
    cancelEdit();
  }

  // Regenerate the reply to a user message — the same effect as editing it and
  // confirming unchanged: keep everything up to and including it, drop the rest,
  // and rerun from that point.
  function retry(i: number) {
    if (streaming || !configured) return;
    setError("");
    cancelEdit();
    generate(messages.slice(0, i + 1));
  }

  // ── Conversations ──────────────────────────────────────────────────────────
  // Snapshot the active conversation's current working messages back into the list.
  function syncActive(list: Conversation[]): Conversation[] {
    return list.map(cv =>
      cv.id === activeIdRef.current ? { ...cv, messages, title: cv.renamed ? cv.title : titleFrom(messages), updatedAt: Date.now() } : cv
    );
  }

  // Manually rename a conversation. An empty name reverts to auto-titling.
  function renameChat(id: string, name: string) {
    const t = name.trim();
    setConversations(prev => {
      const list = prev.map(cv => {
        if (cv.id !== id) return cv;
        const msgs = cv.id === activeIdRef.current ? messages : cv.messages;
        return { ...cv, title: t || titleFrom(msgs), renamed: t.length > 0, updatedAt: Date.now() };
      });
      persistConversations(config, list, activeIdRef.current);
      return list;
    });
  }

  function switchTo(id: string, list: Conversation[]) {
    abortRef.current?.abort();
    setStreaming(false);
    setEditingIndex(null);
    setError("");
    atBottomRef.current = true;
    setConversations(list);
    setActiveId(id);
    activeIdRef.current = id;
    setMessages(list.find(c => c.id === id)?.messages ?? []);
    persistConversations(config, list, id);
    setHistoryOpen(false);
  }

  function newChat() {
    newChatWith(activeCharacterIdRef.current);
  }

  // ── Characters ─────────────────────────────────────────────────────────────
  function newChatWith(characterId: string) {
    const id = newId();
    const conv: Conversation = { id, title: "New chat", messages: [], updatedAt: Date.now(), characterId };
    switchTo(id, [conv, ...syncActive(conversations)]);
  }

  // Pick a character to talk to: retag the current chat if it's empty, else start
  // a fresh one with this character.
  function activateCharacter(id: string) {
    setActiveCharacterId(id);
    activeCharacterIdRef.current = id;
    setCharactersOpen(false);
    if (messages.length === 0) {
      setConversations(prev => {
        const next = prev.map(cv => cv.id === activeIdRef.current ? { ...cv, characterId: id } : cv);
        persistConversations(config, next, activeIdRef.current);
        return next;
      });
    } else {
      newChatWith(id);
    }
  }

  function createCharacter() {
    const ch: Character = { id: newId(), name: "New character", emoji: "🦊", persona: "", focus: "", memories: [] };
    const next = [...charactersRef.current, ch];
    setCharacters(next);
    persistCharacters(next, activeCharacterIdRef.current);
    setEditingCharId(ch.id);
    setCharDraft({ ...ch });
  }

  function saveCharacter() {
    if (!charDraft) return;
    const draft: Character = {
      ...charDraft,
      name: charDraft.name.trim() || "Character",
      emoji: charDraft.emoji.trim() || "💬",
      memories: charDraft.memories.map(m => m.trim()).filter(Boolean),
    };
    const next = charactersRef.current.map(ch => ch.id === draft.id ? draft : ch);
    setCharacters(next);
    persistCharacters(next, activeCharacterIdRef.current);
    setEditingCharId(null);
    setCharDraft(null);
  }

  function deleteCharacter(id: string) {
    if (id === DEFAULT_CHARACTER_ID) return; // the Assistant is permanent
    const nextChars = charactersRef.current.filter(ch => ch.id !== id);
    const nextActive = activeCharacterIdRef.current === id ? DEFAULT_CHARACTER_ID : activeCharacterIdRef.current;
    setCharacters(nextChars);
    setActiveCharacterId(nextActive);
    activeCharacterIdRef.current = nextActive;
    charactersRef.current = nextChars;
    // Reassign any chats that used it back to the default Assistant.
    setConversations(prev => {
      const conv = prev.map(cv => cv.characterId === id ? { ...cv, characterId: DEFAULT_CHARACTER_ID } : cv);
      conversationsRef.current = conv;
      storage.setItem(storageKey, JSON.stringify({ config: configRef.current, conversations: conv, activeId: activeIdRef.current, characters: nextChars, activeCharacterId: nextActive }));
      return conv;
    });
    setEditingCharId(null);
    setCharDraft(null);
  }

  function selectChat(id: string) {
    if (id === activeIdRef.current) { setHistoryOpen(false); return; }
    switchTo(id, syncActive(conversations));
  }

  function deleteChat(id: string) {
    const remaining = syncActive(conversations).filter(c => c.id !== id);
    if (id !== activeIdRef.current) {
      // Deleting a background chat — keep the open one.
      setConversations(remaining);
      persistConversations(config, remaining, activeIdRef.current);
      return;
    }
    // Deleted the open chat — fall back to the most recent, or a fresh empty one.
    if (remaining.length === 0) {
      const conv: Conversation = { id: newId(), title: "New chat", messages: [], updatedAt: Date.now() };
      switchTo(conv.id, [conv]);
    } else {
      const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
      switchTo(next[0].id, next);
    }
  }

  // Combine the user's system prompt with tool guidance. Dashboard data itself
  // never enters the prompt: the model reads it on demand through the
  // read_widget/search_dashboard tools (the request carries the data).
  function buildSystemContent(dash: WidgetEntry[] | null): string {
    const parts: string[] = [BASE_IDENTITY];
    // The active character's persona (the default Assistant's persona is the
    // config system prompt, so editing it in settings still works) + its memory.
    const ch = activeCharacter;
    const persona = ch && ch.id !== DEFAULT_CHARACTER_ID ? ch.persona : config.system;
    if (persona.trim()) parts.push(persona.trim());
    if (ch && ch.memories.length) {
      parts.push(
        `What you (as ${ch.name}) remember about the user from past chats:\n` +
        ch.memories.map(m => `- ${m}`).join("\n") +
        `\nDraw on these naturally when relevant; don't list them back unprompted.`
      );
    }
    const styleHint = LENGTH_PRESETS[config.length].instruction;
    if (styleHint) parts.push(styleHint);
    if (config.useDashboard && dash?.length) {
      const todayStr = new Date().toISOString().split("T")[0];
      parts.push(
        `The user has turned on dashboard access. Today is ${todayStr}. You can read their dashboard through two tools:\n` +
        `- read_widget(id): read one widget's current content. The tool description lists every widget available right now (their notes, feeds, tracker, headlines...). Long content comes back in parts; use find="keywords" to jump to matching sections or page=N to read sequentially.\n` +
        `- search_dashboard(query): keyword-search across ALL widgets at once, when you don't know which widget holds the answer.\n\n` +
        `When the user asks about their notes, what they wrote, their tracked time, or what's new in the things they follow, use these tools rather than guessing. ` +
        `Typical flow: for "what's new on X" read that widget directly; for "where did I mention Y" search the dashboard first, then read the matching widget for context. ` +
        `Notes are the user's own writing: quote them faithfully, with their dates. ` +
        `What the tools return is everything you can see. If the answer isn't there, say so plainly rather than inventing entries.`
      );
    }
    if (config.useCalendar) {
      parts.push(
        `You can read and write the user's calendar through list_calendar_events and create_calendar_event. ` +
        `Use list_calendar_events for any question about their schedule, free time, or upcoming events; today's date is ${new Date().toISOString().split("T")[0]}. ` +
        `Only call create_calendar_event when the user explicitly asks to add or schedule something; afterwards, confirm exactly what you created (title, date, time, calendar). ` +
        `If a create fails on a read-only calendar, say so and suggest a writable one.`
      );
    }
    if (config.useKiwix && config.kiwixUrl) {
      parts.push(
        `You have access to the user's offline Kiwix reference library through the search_kiwix and get_article tools. It spans every book installed on their server (Wikipedia, WikiHow, and more), searched all at once. ` +
        `For factual, encyclopedic, or how-to questions — or when asked to look something up or verify something — use the tools rather than guessing. For casual chat or things you know well, just answer directly.\n\n` +
        `Work as a research loop, one step at a time, thinking between every step:\n` +
        `1. PLAN: restate the goal and what facts you still need. Pick the single best next action. For a question with several parts, the best source is usually ONE overview/list/hub page that contains them all, not separate searches per item.\n` +
        `2. SEARCH: search_kiwix is a library search box backed by article titles and text, NOT a question box. Type ONLY the proper name of the thing you want the page for — a person, place, work, team, or topic — and nothing else. No descriptors, no category words, no dates, no "birthdate/when/history", no year. Example: to find a person's page you type just their name, then read the date off their article — you do NOT type "<nationality> <occupation> <name> birthdate". Extra words almost always return NO results, because it matches them all. If a search misses, the fix is ALWAYS to remove words and try the barest name, never to add more.\n` +
        `3. READ: search snippets are only a hint — actually open the most relevant result with get_article and read it. Its full text includes the page's data tables and lists, so the specifics you need are usually right there.\n` +
        `4. ASSESS: after each result, check what you now have against the goal. If the goal is met, answer. If not, decide the next smart step (a different page, a more specific entry, a follow-up search) and loop again.\n` +
        `5. STOP only when you have the complete answer, or when you've genuinely exhausted reasonable searches and reads — then say what you found and what you couldn't.\n\n` +
        `Never defer the work back to the user (e.g. "tell me the names and I'll look them up") — find them yourself. Don't settle for a partial answer when more steps could complete it. When several pages combine into a fuller answer, read them all and synthesize.\n\n` +
        `CITE YOUR SOURCES: every search result and article is labeled with a number like [1], [2]. In your final answer, put the matching bracketed number right after each claim drawn from that source, e.g. "Messi was born in 1987 [1]." Only cite sources you actually used; never invent a number you weren't shown.`
      );
    }
    if (config.useAnytype && config.anytypeUrl && config.anytypeApiKey && config.anytypeSpaceId) {
      parts.push(
        `You can search the user's own Anytype knowledge base${config.anytypeSpaceName ? ` (space "${config.anytypeSpaceName}")` : ""} — their personal notes, journals, trips, people, projects, and bookmarks — through the search_anytype and read_anytype_object tools. ` +
        `When the user asks about their own notes, what they recorded, or anything personal that would live in their notes, use the tools instead of guessing. For general knowledge, answer directly (or use Kiwix if available).\n\n` +
        `Work as a research loop, one step at a time:\n` +
        `1. SEARCH: call search_anytype with concise keywords — the note's name or topic (e.g. "Istanbul", "reading list"), not a full sentence. It returns numbered objects with ids and snippets.\n` +
        `2. READ: a snippet is only a hint. Open the most relevant object with read_anytype_object (using its id) before answering. Long notes come back in parts (the result says how many) — for a specific fact in a long note, pass find="keywords" to jump straight to the relevant sections (e.g. find="Istanbul" in a journal). Don't try to read a huge note all at once.\n` +
        `For an open-ended question about a WHOLE long note — "summarize my journal", "what does my 2026 journal say about me" — call summarize_anytype_object(id) instead: it digests the entire note part by part and returns per-part summaries for you to synthesize. (It takes a while on a big note; that's expected.)\n` +
        `Each result and object also carries metadata — its Created and Last modified dates (when the note was written/edited) and any custom properties (dates, amounts, tags, links). Use these directly for "when did I write this", "what did I note on…", or questions about those fields.\n` +
        `3. ASSESS: if the answer is complete, give it; otherwise search or read again. When several notes combine into the answer, read them all and synthesize.\n` +
        `4. Don't defer back to the user — find it yourself. If nothing relevant exists in their Anytype, say so plainly rather than inventing it.\n\n` +
        `CITE YOUR SOURCES: each search result and object is labeled [1], [2], …. Put the matching number right after each claim drawn from that note, e.g. "You arrived Feb 22 [1]." Only cite objects you actually read; never invent a number.`
      );
    }
    return parts.join("\n\n");
  }

  // After a reply, quietly review the exchange and save NEW durable facts about
  // the user that are relevant to this character's focus (ignoring off-topic
  // stuff). Runs only for characters that have a focus. Fire-and-forget; a second,
  // non-streaming model call that never blocks the reply.
  async function extractMemories(character: Character, userMsg: string, reply: string) {
    if (!character.focus.trim() || !configured || !userMsg.trim() || !reply.trim()) return;
    try {
      const sys =
        `You maintain the long-term memory of "${character.name}", an assistant focused on: ${character.focus.trim()}. ` +
        `From the exchange below, extract NEW, durable facts ABOUT THE USER that are relevant to that focus. ` +
        `Ignore anything off-topic or outside the focus, transient/one-off details, the assistant's own statements, and anything already known. ` +
        `Output ONLY a JSON array of short factual strings (e.g. ["Has a CS degree"]); output [] if nothing qualifies.` +
        (character.memories.length ? ` Already known: ${JSON.stringify(character.memories)}.` : "");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, stream: false, maxTokens: 220,
          messages: [{ role: "system", content: sys }, { role: "user", content: `User: ${userMsg}\nAssistant: ${reply}` }],
        }),
      });
      if (!res.ok) return;
      const raw = String((await res.json()).content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "");
      const a = raw.indexOf("["), b = raw.lastIndexOf("]");
      if (a === -1 || b <= a) return;
      let facts: unknown;
      try { facts = JSON.parse(raw.slice(a, b + 1)); } catch { return; }
      if (!Array.isArray(facts)) return;
      const clean = facts.map(f => String(f).trim()).filter(f => f.length > 1 && f.length < 200);
      if (!clean.length) return;
      setCharacters(prev => {
        const next = prev.map(ch => {
          if (ch.id !== character.id) return ch;
          const have = new Set(ch.memories.map(m => m.toLowerCase()));
          const added = clean.filter(f => !have.has(f.toLowerCase()));
          if (!added.length) return ch;
          return { ...ch, memories: [...ch.memories, ...added].slice(-40) }; // cap memory size
        });
        persistCharacters(next, activeCharacterIdRef.current);
        return next;
      });
    } catch { /* memory is best-effort */ }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming || !configured) return;
    setError("");
    setInput("");
    await generate([...messages, { role: "user", content: text }]);
  }

  // Stream an assistant reply for a history ending in a user message. Shared by
  // send() and by editing a user message (which truncates, then regenerates).
  async function generate(history: ChatMessage[]) {
    timingRef.current = { start: performance.now(), first: null };
    atBottomRef.current = true; // follow the new turn
    setStreaming(true);

    // Make sure dashboard data is gathered before we build the prompt (cached
    // after the first time, so this is instant on subsequent messages).
    const dash = config.useDashboard ? (ctx ?? await refreshContext()) : null;

    // Assistant placeholder we stream tokens into
    setMessages([...history, { role: "assistant", content: "" }]);

    // Only role/content go upstream. Strip prior assistant <think>…</think>
    // reasoning — replaying it wastes the context window (and reasoning models
    // expect history without it), which otherwise crowds out the conversation.
    const systemContent = buildSystemContent(dash);
    const cleanHistory = history.map(m => ({
      role: m.role,
      content: m.role === "assistant" ? m.content.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim() : m.content,
    }));
    const payload = systemContent
      ? [{ role: "system", content: systemContent }, ...cleanHistory]
      : cleanHistory;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages: payload,
          maxTokens: config.maxTokens,
          reasoningEffort: config.effort === "default" ? "" : config.effort,
          stream: true,
          kiwix: config.useKiwix && config.kiwixUrl
            ? { baseUrl: config.kiwixUrl } // no source: search every book on the server
            : null,
          anytype: config.useAnytype && config.anytypeUrl && config.anytypeApiKey && config.anytypeSpaceId
            ? { baseUrl: config.anytypeUrl, apiKey: config.anytypeApiKey, spaceId: config.anytypeSpaceId, spaceName: config.anytypeSpaceName }
            : null,
          dashboard: dash?.length
            ? { widgets: dash.map(e => ({ id: e.id, title: e.title, type: e.type, text: e.text })) }
            : null,
          caldav: config.useCalendar && calAccount ? calAccount : null,
          // LM Studio sets its idle-unload from the request itself; pass the
          // chosen linger as ttl seconds (Ollama uses its own keep_alive path).
          ttl: backend === "lmstudio" ? ttlSeconds(config.keepAlive) : 0,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let msg = `Request failed (${res.status})`;
        try { msg = (await res.json()).error ?? msg; } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      // Visible reply is everything before the \x1e stats trailer.
      const bodyOf = (s: string) => { const i = s.indexOf("\x1e"); return i === -1 ? s : s.slice(0, i); };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const body = bodyOf(acc);
        if (body && timingRef.current.first == null) timingRef.current.first = performance.now();
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: body };
          return next;
        });
      }

      const body = bodyOf(acc);
      const sep = acc.indexOf("\x1e");
      let tokens = 0;
      let sources: Source[] | undefined;
      if (sep !== -1) {
        try {
          const trailer = JSON.parse(acc.slice(sep + 1));
          tokens = trailer.tokens ?? 0;
          if (Array.isArray(trailer.sources) && trailer.sources.length) sources = trailer.sources;
        } catch {}
      }
      const end = performance.now();
      const { start, first } = timingRef.current;
      const ttft = first ? (first - start) / 1000 : 0;
      const genS = first ? (end - first) / 1000 : (end - start) / 1000;
      const stats: MsgStats | undefined = tokens > 0
        ? { tokens, ttft, total: (end - start) / 1000, tps: genS > 0 ? tokens / genS : 0 }
        : undefined;

      const finalMessages: ChatMessage[] = [...history, { role: "assistant", content: body, stats, sources }];
      setMessages(finalMessages);
      persist(config, finalMessages);
      // Ollama resets to its default keep_alive after a reply — restore the chosen
      // linger so it sticks. (LM Studio's ttl already rode the request above.)
      if (config.keepAlive && backend === "ollama") { postPower({ keepAlive: config.keepAlive }); pollPower(); }
      // Let the active character quietly remember anything relevant (uses refs so
      // it tracks the conversation's character even if state shifted mid-stream).
      const convChar = conversationsRef.current.find(cv => cv.id === activeIdRef.current)?.characterId ?? activeCharacterIdRef.current;
      const memCh = charactersRef.current.find(ch => ch.id === convChar);
      const lastUser = [...history].reverse().find(m => m.role === "user")?.content ?? "";
      if (memCh) extractMemories(memCh, lastUser, body.replace(/<think>[\s\S]*?<\/think>/gi, "").trim());
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Keep whatever streamed so far; drop a trailing empty assistant turn.
        setMessages(prev => {
          const next = prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev;
          queueMicrotask(() => persist(config, next));
          return next;
        });
      } else {
        setError(String(err instanceof Error ? err.message : err));
        setMessages(prev => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  // Active conversation's display title — its manual name, or one auto-derived
  // from the first message.
  const activeConv = conversations.find(cv => cv.id === activeId);
  const chatTitle = activeConv?.renamed ? activeConv.title : titleFrom(messages);

  // Hover-revealed header action icon (matches the other widgets).
  const actionCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`;
  // Dashboard controls stay visible (at a steady opacity) while the mode is on.
  const dashCtrlCls = `${c.icon} opacity-55 hover:opacity-100 transition-opacity`;
  // Filled pill for an active (on) data toggle, so it's clearly distinct from off.
  const toolOnCls = `${c.label} bg-black/10 dark:bg-white/15 opacity-100 transition-colors`;

  return (
    <div className={`rounded-2xl border flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>

      {/* Header — single row, no divider (a border here reads like a tab bar) */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
        <span className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          {/* Active character — click to switch/manage personas */}
          <button
            onClick={() => setCharactersOpen(true)}
            title={activeCharacter ? `Talking to ${activeCharacter.name}, click to switch character` : "Characters"}
            className="shrink-0 text-sm leading-none hover:opacity-70 transition-opacity"
          >
            {activeCharacter && activeCharacter.id !== DEFAULT_CHARACTER_ID ? activeCharacter.emoji : <Bot size={14} className="opacity-60" />}
          </button>
          <span className="flex flex-col min-w-0 leading-tight">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={() => { renameChat(activeId, titleDraft); setEditingTitle(false); }}
                onKeyDown={e => {
                  if (e.key === "Enter") { renameChat(activeId, titleDraft); setEditingTitle(false); }
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                placeholder={titleFrom(messages)}
                className="text-xs font-medium bg-transparent outline-none border-b border-current/30 min-w-0 w-32"
              />
            ) : (
              <button
                onClick={() => { setTitleDraft(activeConv?.renamed ? activeConv.title : ""); setEditingTitle(true); }}
                title="Rename chat"
                className="text-xs font-medium truncate text-left hover:opacity-80"
              >
                {chatTitle}
              </button>
            )}
            <span className="text-[10px] opacity-45 truncate">
              {activeCharacter && activeCharacter.id !== DEFAULT_CHARACTER_ID ? `${activeCharacter.name}${config.model ? " · " : ""}` : ""}{config.model}
            </span>
          </span>
        </span>
        {!settingsOpen && (
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Ollama model-residency pill — only shown for Ollama servers */}
            {powerCapable && (
              <div className="relative">
                <button
                  onClick={() => setPowerOpen(o => !o)}
                  title={isLoaded ? `Model loaded on ${backend}: click to control how long it stays` : "Model not loaded"}
                  className={`flex items-center gap-1 text-[10px] leading-none rounded-full px-1.5 py-1 border transition-colors ${
                    isLoaded
                      ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                      : `border-[var(--surface-border)] ${c.label} opacity-55 hover:opacity-90`
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isLoaded ? "bg-emerald-500" : "bg-current opacity-40"}`} />
                  {isLoaded ? (pinned ? "loaded · ∞" : hasCountdown ? `loaded · ${fmtRemaining(remainingMs)}` : "loaded") : "unloaded"}
                </button>
                {powerOpen && (
                  <>
                    {/* click-away backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setPowerOpen(false)} />
                    <div className={`absolute right-0 top-7 z-50 w-44 rounded-xl border ${c.border} ${c.bg} shadow-lg p-2.5 flex flex-col gap-2`}>
                      <p className={`text-[10px] opacity-50 ${c.label} flex items-center gap-1`}>
                        <Power size={11} /> Keep model loaded
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { v: "5m", label: "5m" },
                          { v: "30m", label: "30m" },
                          { v: "1h", label: "1h" },
                          { v: "-1", label: "∞" },
                        ].map(opt => (
                          <button
                            key={opt.v}
                            disabled={powerBusy}
                            onClick={() => chooseLinger(opt.v, { load: opt.v === "-1" })}
                            title={opt.v === "-1" ? "Load now and keep it loaded until you unload" : `Linger ${opt.label} after each reply`}
                            className={`px-2 py-1 rounded-lg text-[11px] border transition-colors disabled:opacity-40 ${
                              config.keepAlive === opt.v
                                ? "border-[var(--surface-border-focus)] bg-[var(--surface)] text-[var(--text-primary)]"
                                : "border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--surface-border-focus)]"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={unloadNow}
                        disabled={powerBusy || !isLoaded}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] border border-[var(--surface-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--surface-border-focus)] disabled:opacity-30"
                      >
                        {powerBusy ? <Loader size={11} className="animate-spin" /> : <Power size={11} />}
                        Unload now
                      </button>
                      <p className={`text-[9px] opacity-40 ${c.label} leading-snug`}>
                        {config.keepAlive === "-1"
                          ? "Stays loaded until you unload."
                          : config.keepAlive
                            ? `Unloads after ${config.keepAlive} idle.`
                            : backend === "lmstudio"
                              ? "Using LM Studio's default (60m) idle unload."
                              : "Using Ollama's default linger."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
            {messages.length > 0 && (
              <button onClick={clearChat} title="Clear this conversation" className={actionCls}>
                <RotateCcw size={14} />
              </button>
            )}
            <button onClick={() => setCharactersOpen(true)} title="Characters" className={actionCls}>
              <Users size={14} />
            </button>
            <button onClick={() => setHistoryOpen(true)} title="Chats" className={actionCls}>
              <MessageSquare size={14} />
            </button>
            <button onClick={openSettings} title="Settings" className={actionCls}>
              <Pencil size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Dashboard-data status — quiet borderless subtitle */}
      {!settingsOpen && config.useDashboard && (
        <div className={`shrink-0 px-4 pb-1.5 text-[10px] truncate ${c.label} opacity-45`}>
          {gathering
            ? "gathering your dashboard data…"
            : ctx?.length
              ? `dashboard lookup on · ${ctx.length} widget${ctx.length === 1 ? "" : "s"} · ~${Math.round(ctxChars / 1000)}k chars readable`
              : "dashboard lookup on · no data found"}
        </div>
      )}

      {/* Chats list — switches the whole widget to a list of saved conversations */}
      {historyOpen && (
        <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col ${c.bg}`}>
          <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
            <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
              <MessageSquare size={13} />
              Chats
            </span>
            <div className="flex items-center gap-3">
              <button onClick={newChat} title="New chat" className={`opacity-60 hover:opacity-100 ${c.label}`}>
                <Plus size={15} />
              </button>
              <button onClick={() => setHistoryOpen(false)} title="Close" className={`opacity-50 hover:opacity-90 ${c.label}`}>
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 flex flex-col gap-1">
            {[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(cv => {
              const isActive = cv.id === activeId;
              // The active chat's live title/time come from the working copy.
              const title = isActive ? chatTitle : cv.title;
              const count = isActive ? messages.length : cv.messages.length;
              const renaming = renamingId === cv.id;
              return (
                <div
                  key={cv.id}
                  onClick={() => { if (!renaming) selectChat(cv.id); }}
                  className={`group/row flex items-start gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                    isActive ? `${c.bg} ring-1 ring-[var(--surface-border-focus)]` : "hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {renaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setRenameDraft(e.target.value)}
                        onBlur={() => { renameChat(cv.id, renameDraft); setRenamingId(null); }}
                        onKeyDown={e => {
                          if (e.key === "Enter") { renameChat(cv.id, renameDraft); setRenamingId(null); }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        placeholder={titleFrom(isActive ? messages : cv.messages)}
                        className={`w-full text-sm bg-transparent outline-none border-b border-current/30 ${c.text}`}
                      />
                    ) : (
                      <p className={`text-sm truncate ${c.text} ${isActive ? "font-medium" : "opacity-80"}`}>{title}</p>
                    )}
                    <p className={`text-[10px] ${c.label} opacity-45`}>
                      {count} message{count === 1 ? "" : "s"}{cv.updatedAt ? ` · ${timeAgo(cv.updatedAt)}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setRenameDraft(cv.renamed ? cv.title : ""); setRenamingId(cv.id); }}
                    title="Rename chat"
                    className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); deleteChat(cv.id); }}
                    title="Delete chat"
                    className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Characters list — pick/manage personas */}
      {charactersOpen && (
        <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col ${c.bg}`}>
          <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
            <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
              <Users size={13} /> Characters
            </span>
            <div className="flex items-center gap-3">
              <button onClick={createCharacter} title="New character" className={`opacity-60 hover:opacity-100 ${c.label}`}><Plus size={15} /></button>
              <button onClick={() => setCharactersOpen(false)} title="Close" className={`opacity-50 hover:opacity-90 ${c.label}`}><X size={14} /></button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 flex flex-col gap-1">
            {characters.map(ch => {
              const isActive = ch.id === activeConvCharId;
              return (
                <div
                  key={ch.id}
                  onClick={() => activateCharacter(ch.id)}
                  className={`group/row flex items-start gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors ${isActive ? `${c.bg} ring-1 ring-[var(--surface-border-focus)]` : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                >
                  <span className="text-base leading-none mt-0.5 shrink-0">{ch.id === DEFAULT_CHARACTER_ID ? "🤖" : ch.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${c.text} ${isActive ? "font-medium" : "opacity-80"}`}>{ch.name}</p>
                    <p className={`text-[10px] ${c.label} opacity-45 truncate`}>
                      {ch.id === DEFAULT_CHARACTER_ID ? "default · no memory" : (ch.focus ? `remembers: ${ch.focus}` : "no focus — won't auto-remember")}
                      {ch.memories.length ? ` · ${ch.memories.length} ${ch.memories.length === 1 ? "memory" : "memories"}` : ""}
                    </p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setEditingCharId(ch.id); setCharDraft({ ...ch }); }} title="Edit" className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}><Pencil size={12} /></button>
                  {ch.id !== DEFAULT_CHARACTER_ID && (
                    <button onClick={e => { e.stopPropagation(); deleteCharacter(ch.id); }} title="Delete character" className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}><X size={13} /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Character editor */}
      {editingCharId && charDraft && (
        <div className={`absolute inset-0 z-50 rounded-2xl flex flex-col ${c.bg}`}>
          <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
            <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
              <Users size={13} /> Edit character
            </span>
            <div className="flex items-center gap-3">
              <button onClick={() => { setEditingCharId(null); setCharDraft(null); }} title="Cancel" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
              <button onClick={saveCharacter} title="Save" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Check size={14} /></button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3">
            <div className="flex gap-2">
              <SettingsInput value={charDraft.emoji} onChange={e => setCharDraft(d => (d ? { ...d, emoji: e.target.value } : d))} placeholder="🎓" maxLength={8} className="!w-14 text-center text-lg px-2" />
              <SettingsInput value={charDraft.name} onChange={e => setCharDraft(d => (d ? { ...d, name: e.target.value } : d))} placeholder="Education Coach" className="flex-1" />
            </div>
            {charDraft.id === DEFAULT_CHARACTER_ID ? (
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">This is the default Assistant. Edit its system prompt in Settings; it doesn&apos;t keep memory. Create a new character for a persona with its own scoped memory.</p>
            ) : (
              <>
                <div>
                  <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Persona <span className="opacity-60">(its system prompt)</span></p>
                  <SettingsTextarea value={charDraft.persona} onChange={e => setCharDraft(d => (d ? { ...d, persona: e.target.value } : d))} rows={4} placeholder="You are my education coach. Help me plan, stay accountable, and learn effectively." />
                </div>
                <div>
                  <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Remembers <span className="opacity-60">(what it cares about; empty = no memory)</span></p>
                  <SettingsInput value={charDraft.focus} onChange={e => setCharDraft(d => (d ? { ...d, focus: e.target.value } : d))} placeholder="my education, goals, academic background" />
                </div>
                <div>
                  <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Memories <span className="opacity-60">({charDraft.memories.length})</span></p>
                  <div className="flex flex-col gap-1">
                    {charDraft.memories.map((m, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={m} onChange={e => setCharDraft(d => { if (!d) return d; const mem = [...d.memories]; mem[i] = e.target.value; return { ...d, memories: mem }; })} className="flex-1 text-xs border border-[var(--surface-border)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] bg-[var(--surface)]" />
                        <button onClick={() => setCharDraft(d => (d ? { ...d, memories: d.memories.filter((_, j) => j !== i) } : d))} className="shrink-0 text-[var(--text-muted)] hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    ))}
                    <button onClick={() => setCharDraft(d => (d ? { ...d, memories: [...d.memories, ""] } : d))} className="self-start text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center gap-1 mt-0.5"><Plus size={11} /> add memory</button>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">It also adds to these automatically after chats, based on what you share that fits its focus.</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Context viewer overlay: the system message, then the widget data the
          model can reach through its tools */}
      {showContext && (
        <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col ${c.bg}`}>
          <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
            <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
              <Database size={13} />
              Model context{ctx ? ` · ${ctx.length} widget${ctx.length === 1 ? "" : "s"} · ~${Math.round(ctxChars / 1000)}k chars readable` : ""}
            </span>
            <button onClick={() => setShowContext(false)} title="Close" className={`opacity-50 hover:opacity-90 ${c.label}`}>
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <pre className={`text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono ${c.text} opacity-90`}>
              {buildSystemContent(ctx) || "No context gathered."}
              {ctx?.length
                ? "\n\n──── data readable through tools (not in the prompt) ────\n\n" + ctx.map(e => e.text).join("\n\n")
                : ""}
            </pre>
          </div>
        </div>
      )}

      {settingsOpen ? (
        /* Settings panel: Model, Behavior, Data sources */
        <div className="flex flex-col gap-3 flex-1 min-h-0 p-4">
          <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">

            <p className={`text-[10px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-50 ${c.label}`}>Model</p>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>API URL</p>
              <SettingsInput
                autoFocus
                type="url"
                value={draft.baseUrl}
                onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))}
                placeholder="http://localhost:11434/v1"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setDraft(d => ({ ...d, baseUrl: p.url }))}
                    className="px-2 py-0.5 rounded-full text-[10px] border border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--surface-border-focus)]"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className={`text-xs opacity-50 ${c.label}`}>Model</p>
                <button
                  onClick={() => fetchModels(draft)}
                  disabled={loadingModels}
                  className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-40"
                  title="Load models from server"
                >
                  {loadingModels ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Load models
                </button>
              </div>
              {models.length > 0 ? (
                <SettingsSelect
                  value={draft.model}
                  onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
                >
                  <option value="" disabled>Select a model…</option>
                  {draft.model && !models.includes(draft.model) && (
                    <option value={draft.model}>{draft.model} (custom)</option>
                  )}
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </SettingsSelect>
              ) : (
                <SettingsInput
                  type="text"
                  value={draft.model}
                  onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
                  placeholder="e.g. llama3.2, or click Load models"
                />
              )}
              {modelsError && <p className="text-red-400 text-[11px] mt-1">{modelsError}</p>}
            </div>

            <p className={`text-[10px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-50 mt-1 ${c.label}`}>Behavior</p>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>System prompt <span className="opacity-60">(optional)</span></p>
              <SettingsTextarea
                value={draft.system}
                onChange={e => setDraft(d => ({ ...d, system: e.target.value }))}
                placeholder="You are a helpful assistant."
                rows={2}
              />
            </div>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Response style</p>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(LENGTH_PRESETS) as Length[]).map(key => (
                  <button
                    key={key}
                    onClick={() => setDraft(d => ({ ...d, length: key, maxTokens: LENGTH_PRESETS[key].cap }))}
                    title={LENGTH_PRESETS[key].instruction || "No length instruction; uses the server default."}
                    className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                      draft.length === key
                        ? "border-[var(--surface-border-focus)] bg-[var(--surface)] text-[var(--text-primary)]"
                        : "border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--surface-border-focus)]"
                    }`}
                  >
                    {LENGTH_PRESETS[key].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Thinking <span className="opacity-60">(reasoning models)</span></p>
              <div className="flex flex-wrap gap-1">
                {EFFORT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setDraft(d => ({ ...d, effort: opt.value }))}
                    title={opt.value === "none" ? "Disable the model's chain-of-thought (fastest)" : opt.value === "default" ? "Use the model's default" : `reasoning_effort: ${opt.value}`}
                    className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                      draft.effort === opt.value
                        ? "border-[var(--surface-border-focus)] bg-[var(--surface)] text-[var(--text-primary)]"
                        : "border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--surface-border-focus)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Max response length <span className="opacity-60">(tokens, 0 = no limit)</span></p>
              <SettingsInput
                type="number"
                min={0}
                step={50}
                value={draft.maxTokens || ""}
                onChange={e => setDraft(d => ({ ...d, maxTokens: Number(e.target.value) }))}
                placeholder="0"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {[128, 256, 512, 1024].map(n => (
                  <button
                    key={n}
                    onClick={() => setDraft(d => ({ ...d, maxTokens: n }))}
                    className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                      draft.maxTokens === n
                        ? "border-[var(--surface-border-focus)] bg-[var(--surface)] text-[var(--text-primary)]"
                        : "border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--surface-border-focus)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <p className={`text-[10px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-50 mt-1 ${c.label}`}>Data sources</p>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Dashboard widgets the model may read</p>
              {roster.length === 0 ? (
                <p className="text-[10px] text-[var(--text-muted)]">No data widgets on the active dashboard.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {roster.map(w => {
                    const on = draft.dashboardWidgets[w.id] !== false;
                    return (
                      <label key={w.id} className={`flex items-center gap-2 text-xs cursor-pointer ${c.text} ${on ? "opacity-85" : "opacity-45"}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setDraft(d => ({ ...d, dashboardWidgets: { ...d.dashboardWidgets, [w.id]: !on } }))}
                          className="accent-current"
                        />
                        <span className="truncate">{w.title}</span>
                        <span className={`text-[10px] opacity-60 ${c.label}`}>{w.type}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Turn lookup on with the database icon by the send button.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className={`text-xs opacity-50 ${c.label}`}>Kiwix library <span className="opacity-60">(all books are searched)</span></p>
                <button
                  onClick={() => loadKiwixSources(draft.kiwixUrl)}
                  disabled={loadingKiwix || !draft.kiwixUrl.startsWith("http")}
                  className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-40"
                  title="List the books on the server"
                >
                  {loadingKiwix ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Check server
                </button>
              </div>
              <SettingsInput
                type="url"
                value={draft.kiwixUrl}
                onChange={e => setDraft(d => ({ ...d, kiwixUrl: e.target.value }))}
                placeholder="Kiwix URL, e.g. http://192.168.1.24:3702"
              />
              {kiwixSources.length > 0 && (
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {kiwixSources.length} book{kiwixSources.length === 1 ? "" : "s"}: {kiwixSources.map(s => s.title).join(", ")}
                </p>
              )}
              {kiwixError && <p className="text-red-400 text-[11px] mt-1">{kiwixError}</p>}
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Adding books to the server widens the search automatically. Turn lookup on with the library icon by the send button.</p>
            </div>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Anytype</p>
              <SettingsInput
                type="url"
                value={draft.anytypeUrl}
                onChange={e => setDraft(d => ({ ...d, anytypeUrl: e.target.value, anytypeApiKey: "" }))}
                placeholder="http://127.0.0.1:31009"
              />
              {draft.anytypeApiKey ? (
                anytypeSpaces.length > 0 ? (
                  <SettingsSelect
                    value={draft.anytypeSpaceId}
                    onChange={e => {
                      const s = anytypeSpaces.find(x => x.id === e.target.value);
                      setDraft(d => ({ ...d, anytypeSpaceId: e.target.value, anytypeSpaceName: s?.name ?? "" }));
                    }}
                    className="mt-1.5"
                  >
                    {anytypeSpaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </SettingsSelect>
                ) : (
                  <p className="text-[10px] text-[var(--text-muted)] mt-1.5 flex items-center gap-1">
                    {anytypeBusy && <Loader size={10} className="animate-spin" />} paired ✓ {draft.anytypeSpaceName && `· ${draft.anytypeSpaceName}`}
                  </p>
                )
              ) : anytypePairing === "awaiting-code" ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <SettingsInput
                    inputMode="numeric"
                    value={anytypeCode}
                    onChange={e => setAnytypeCode(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && confirmAnytypeCode()}
                    placeholder="4-digit code from Anytype"
                    className="flex-1 tracking-widest"
                  />
                  <button
                    onClick={confirmAnytypeCode}
                    disabled={anytypeBusy || !anytypeCode.trim()}
                    className="text-xs px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-primary)] hover:border-[var(--surface-border-focus)] disabled:opacity-40 shrink-0"
                  >
                    {anytypeBusy ? <Loader size={12} className="animate-spin" /> : "Confirm"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={startAnytypePairing}
                  disabled={anytypeBusy || !draft.anytypeUrl.startsWith("http")}
                  className="mt-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-primary)] hover:border-[var(--surface-border-focus)] disabled:opacity-40"
                >
                  {anytypeBusy ? <span className="flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> contacting…</span> : "Pair with Anytype"}
                </button>
              )}
              {anytypeError && <p className="text-red-400 text-[11px] mt-1">{anytypeError}</p>}
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Pair, pick a space, then turn lookup on with the box icon by the send button.</p>
            </div>

          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 shrink-0">
            <button
              onClick={() => setSettingsOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Cancel"
            >
              <X size={14} />
            </button>
            <button
              onClick={saveSettings}
              disabled={!draft.baseUrl.trim() || !draft.model.trim()}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
              title="Save"
            >
              <Check size={14} />
            </button>
          </div>
        </div>
      ) : (
        /* Chat view */
        <>
          <div ref={scrollRef} onScroll={onMessagesScroll} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {!configured ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-4">
                <Bot size={20} className={`opacity-40 ${c.text}`} />
                <p className={`text-xs opacity-45 ${c.text}`}>
                  Connect a local or OpenAI-compatible model. Hover and click the pencil to set the API URL and model.
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className={`text-xs opacity-40 ${c.text}`}>Ask anything…</p>
              </div>
            ) : (
              messages.map((m, i) => {
                const inProgress = streaming && i === messages.length - 1 && m.role === "assistant";
                const secs = elapsedMs / 1000;
                const editing = editingIndex === i;
                const canEdit = !streaming && !!m.content;
                if (editing) {
                  return (
                    <div key={i} className="flex flex-col gap-1 w-full">
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={e => setEditDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === "Escape") cancelEdit(); }}
                        rows={Math.min(12, Math.max(3, editDraft.split("\n").length))}
                        className="w-full text-sm border border-[var(--surface-border)] rounded-xl px-3 py-2 outline-none focus:border-[var(--surface-border-focus)] bg-[var(--surface)] text-[var(--text-primary)] font-mono resize-y"
                      />
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={cancelEdit} title="Cancel" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
                        <button onClick={saveEdit} title="Save" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Check size={14} /></button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className={`flex flex-col gap-0.5 group/msg ${m.role === "user" ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words ${
                        m.role === "user"
                          ? "whitespace-pre-wrap bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-primary)] shadow-sm"
                          : `${c.text} opacity-90`
                      }`}
                    >
                      {m.role === "assistant"
                        ? (m.content
                            ? renderAssistant(m.content, inProgress, c.label, m.sources)
                            : (inProgress ? <span className="inline-block w-2 h-2 rounded-full bg-current opacity-50 animate-pulse" /> : null))
                        : m.content}
                    </div>
                    {!inProgress && m.role === "assistant" && m.sources && m.sources.length > 0 && (
                      <SourcesList sources={m.sources} labelClass={c.label} textClass={c.text} />
                    )}
                    {inProgress && (
                      <span className={`px-1 text-[10px] ${c.text} opacity-45`}>
                        {m.content
                          ? (m.content.lastIndexOf("<think>") > m.content.lastIndexOf("</think>") ? "thinking" : "generating")
                          : (secs >= 3 ? "loading model / thinking" : "thinking")}… {secs.toFixed(1)}s
                      </span>
                    )}
                    <div className="flex items-center gap-2 px-1">
                      {!inProgress && m.role === "assistant" && m.stats && m.stats.tokens > 0 && (
                        <span className={`text-[10px] ${c.text} opacity-40`}>
                          {m.stats.tps.toFixed(1)} tok/s · {m.stats.tokens} tokens · {m.stats.total.toFixed(1)}s
                          {m.stats.ttft >= 0.05 ? ` · ${m.stats.ttft.toFixed(1)}s to first` : ""}
                        </span>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => startEdit(i)}
                          title={m.role === "user" ? "Edit message (reruns from here)" : "Edit reply"}
                          className={`opacity-0 group-hover/msg:opacity-50 [@media(hover:none)]:!opacity-50 hover:!opacity-90 ${c.icon}`}
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {canEdit && m.role === "user" && (
                        <button
                          onClick={() => retry(i)}
                          title="Regenerate the reply from here"
                          className={`opacity-0 group-hover/msg:opacity-50 [@media(hover:none)]:!opacity-50 hover:!opacity-90 ${c.icon}`}
                        >
                          <RefreshCw size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            {error && <p className="text-red-400 text-xs">{error}</p>}
          </div>

          {/* Composer */}
          <div className={`shrink-0 p-2.5 border-t ${c.border}`}>
            <div className="flex items-end gap-2 bg-[var(--surface)] rounded-2xl border border-[var(--surface-border)] px-3 py-1.5">
              <textarea
                ref={composerRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={!configured || !loaded}
                rows={1}
                placeholder={configured ? "Message…" : "Configure a model first"}
                className="flex-1 resize-none overflow-y-auto text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-transparent py-1 disabled:opacity-50"
              />
              {/* Dashboard tools, revealed by the "+" toggle */}
              {toolsOpen && (
                <div className="flex items-center shrink-0">
                  <button
                    onClick={toggleDashboard}
                    title={config.useDashboard ? "Using dashboard data: click to turn off" : "Answer using my dashboard data"}
                    className={`p-1.5 rounded-full ${config.useDashboard ? toolOnCls : dashCtrlCls}`}
                  >
                    <Database size={14} />
                  </button>
                  {config.useDashboard && (
                    <button
                      onClick={() => setShowContext(true)}
                      disabled={!ctx?.length}
                      title="View the data the model can read"
                      className={`p-1.5 rounded-full ${dashCtrlCls} disabled:!opacity-25`}
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  {config.useDashboard && (
                    <button
                      onClick={() => refreshContext()}
                      disabled={gathering}
                      title="Refresh dashboard data"
                      className={`p-1.5 rounded-full ${dashCtrlCls}`}
                    >
                      <RefreshCw size={14} className={gathering ? "animate-spin" : ""} />
                    </button>
                  )}
                  <button
                    onClick={() => (config.kiwixUrl ? toggleKiwix() : openSettings())}
                    title={
                      !config.kiwixUrl
                        ? "Set up the Kiwix library in settings"
                        : config.useKiwix
                          ? "Kiwix lookup on (all books): click to turn off"
                          : "Let me look things up in your Kiwix library"
                    }
                    className={`p-1.5 rounded-full ${config.useKiwix ? toolOnCls : dashCtrlCls} ${!config.kiwixUrl ? "opacity-30" : ""}`}
                  >
                    <Library size={14} />
                  </button>
                  <button
                    onClick={() => (config.anytypeApiKey && config.anytypeSpaceId ? toggleAnytype() : openSettings())}
                    title={
                      !config.anytypeApiKey || !config.anytypeSpaceId
                        ? "Set up Anytype lookup in settings"
                        : config.useAnytype
                          ? `Anytype lookup on (${config.anytypeSpaceName || "space"}) — click to turn off`
                          : "Let me look things up in your Anytype"
                    }
                    className={`p-1.5 rounded-full ${config.useAnytype ? toolOnCls : dashCtrlCls} ${(!config.anytypeApiKey || !config.anytypeSpaceId) ? "opacity-30" : ""}`}
                  >
                    <Layers size={14} />
                  </button>
                  <button
                    onClick={() => calAccount && toggleCalendar()}
                    title={
                      !calAccount
                        ? "Add and configure a Calendar widget first"
                        : config.useCalendar
                          ? "Calendar access on: click to turn off"
                          : "Let me read and add to your calendar"
                    }
                    className={`p-1.5 rounded-full ${config.useCalendar ? toolOnCls : dashCtrlCls} ${!calAccount ? "opacity-30" : ""}`}
                  >
                    <CalendarDays size={14} />
                  </button>
                </div>
              )}
              <button
                onClick={() => setToolsOpen(o => !o)}
                title={toolsOpen ? "Hide data tools" : "Data tools"}
                className={`shrink-0 p-1.5 rounded-full transition-transform ${toolsOpen ? `rotate-45 ${dashCtrlCls}` : (config.useDashboard || config.useKiwix || config.useAnytype || config.useCalendar) ? `opacity-90 ${c.label}` : dashCtrlCls}`}
              >
                <Plus size={14} />
              </button>
              {streaming ? (
                <button
                  onClick={stop}
                  title="Stop"
                  className="shrink-0 p-1.5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim() || !configured}
                  title="Send"
                  className={`shrink-0 p-1.5 rounded-full disabled:opacity-30 ${c.label} hover:opacity-80`}
                >
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
