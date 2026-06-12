"use client";

import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Bot, Pencil, Send, Square, Check, X, RefreshCw, Loader, Database, MessageSquare, Plus, ChevronRight, ChevronDown, Library, Power, Layers, Users, Trash2, CalendarDays, EllipsisVertical, Brain, Copy, Paperclip, ChevronsRight } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { isDemoMode } from "@/lib/demo";
import { listDashboardWidgets, getCalendarAccount, type WidgetRosterItem, type CalendarSource } from "@/lib/dashboardContext";
import { SettingsInput, SettingsSelect, SettingsTextarea } from "./ui/Field";
import { EmptyState } from "./ui/WidgetChrome";
import { stripThinking } from "@/lib/citations";
import { tagColor } from "@/lib/colors";
import Markdown from "./Markdown";

type Role = "user" | "assistant";
type MsgStats = { tps: number; tokens: number; total: number; ttft: number };
type Source = { n: number; title: string; url: string; cited?: boolean };
type Proposal = {
  title: string; start: string; end?: string; location?: string; description?: string;
  calendarName: string; calendarUrl: string;
  status: "pending" | "added" | "dismissed" | "failed";
};
type ChatMessage = { role: Role; content: string; at?: number; images?: string[]; memory?: string[]; proposals?: Proposal[]; stats?: MsgStats; sources?: Source[] };
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

// Messenger-style stamps: "14:32" on each message, day pills between groups.
function msgTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function msgDayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, new Date(Date.now() - 86400000))) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}) });
}

// Downscale an attached image so stored conversations and model payloads stay
// small (max 1568px on the long edge, JPEG on a white background).
async function fileToDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const MAX = 1568;
  const k = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Full-viewport image viewer: scroll wheel or pinch to zoom, drag to pan when
// zoomed, double-click to toggle, Escape / X / backdrop click to leave.
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(s => Math.min(6, Math.max(1, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => { if (scale === 1) setPos({ x: 0, y: 0 }); }, [scale]);

  const dist = () => {
    const pts = [...pointers.current.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  return createPortal(
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center touch-none overscroll-contain"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onPointerDown={e => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) pinchStart.current = { dist: dist(), scale };
        else if (scale > 1) drag.current = { x: pos.x, y: pos.y, px: e.clientX, py: e.clientY };
      }}
      onPointerMove={e => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2 && pinchStart.current) {
          setScale(Math.min(6, Math.max(1, pinchStart.current.scale * (dist() / pinchStart.current.dist))));
        } else if (drag.current) {
          setPos({ x: drag.current.x + e.clientX - drag.current.px, y: drag.current.y + e.clientY - drag.current.py });
        }
      }}
      onPointerUp={e => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinchStart.current = null;
        if (pointers.current.size === 0) drag.current = null;
      }}
      onPointerCancel={e => {
        pointers.current.delete(e.pointerId);
        pinchStart.current = null;
        drag.current = null;
      }}
      onDoubleClick={() => setScale(s => (s > 1 ? 1 : 2.5))}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="attachment"
        draggable={false}
        className="max-w-[92vw] max-h-[92vh] select-none rounded-lg shadow-2xl"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: scale > 1 ? "grab" : "zoom-in",
          transition: pinchStart.current || drag.current ? "none" : "transform 120ms",
        }}
      />
      <button onClick={onClose} title="Close" className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20">
        <X size={18} />
      </button>
    </div>,
    document.body
  );
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
        {/[\u{1F50E}\u{1F4D6}\u{1F4CA}\u{1F9E9}]/u.test(content)
          ? (active ? "Researching…" : "Research trail")
          : (active ? "Thinking…" : "Thinking")}
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
  { value: "default", label: "Auto" },
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  // Roster of readable widgets (names only; content is fetched server-side
  // when the model explicitly calls a tool).
  const [roster, setRoster] = useState<WidgetRosterItem[]>([]);
  // @-mention picker state: the partial token being typed and its position.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionMatches = mention
    ? roster.filter(w =>
        w.title.toLowerCase().startsWith(mention.query.toLowerCase()) ||
        w.type.toLowerCase().startsWith(mention.query.toLowerCase())
      ).slice(0, 6)
    : [];

  function detectMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]*)$/);
    if (!m) { setMention(null); return; }
    if (!roster.length) listDashboardWidgets().then(setRoster).catch(() => {});
    setMention({ query: m[2], start: caret - m[2].length - 1 });
    setMentionIdx(0);
  }

  function insertMention(w: WidgetRosterItem) {
    if (!mention) return;
    const el = composerRef.current;
    const caret = el?.selectionStart ?? input.length;
    const next = input.slice(0, mention.start) + "@" + w.title + " " + input.slice(caret);
    setInput(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + w.title.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }
  // CalDAV account from the dashboard's Calendar widget (null = none
  // configured); enabling that widget's row grants agenda + calendar tools.
  const [calSource, setCalSource] = useState<CalendarSource | null>(null);
  useEffect(() => { getCalendarAccount().then(setCalSource).catch(() => {}); }, []);
  const anySourceOn = Object.values(config.dashboardWidgets).some(Boolean);
  const calendarOn = !!(calSource && config.dashboardWidgets[calSource.widgetId]);
  // Image attachments: pending (pre-send) data URLs, the lightbox viewer, and
  // whether the selected model can see images (null = backend can't tell us).
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [visionOk, setVisionOk] = useState<boolean | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!config.baseUrl || !config.model) { setVisionOk(null); return; }
    let stale = false;
    fetch(`/api/model?baseUrl=${encodeURIComponent(config.baseUrl)}&op=caps&model=${encodeURIComponent(config.model)}`)
      .then(r => r.json())
      .then(d => { if (!stale) setVisionOk(typeof d.vision === "boolean" ? d.vision : null); })
      .catch(() => { if (!stale) setVisionOk(null); });
    return () => { stale = true; };
  }, [config.baseUrl, config.model]);

  async function attachImages(files: Iterable<File>) {
    if (visionOk === false) {
      setError(`${config.model} can't see images; pick a vision-capable model in settings.`);
      return;
    }
    const room = 3 - pendingImages.length;
    const urls: string[] = [];
    for (const f of [...files].slice(0, Math.max(0, room))) {
      const url = await fileToDataUrl(f);
      if (url) urls.push(url);
    }
    if (urls.length) { setError(""); setPendingImages(prev => [...prev, ...urls].slice(0, 3)); }
  }



  // Model residency. `backend` is null until we know what this server is: null =
  // not a controllable backend (control hidden), "ollama"/"lmstudio" = supported.
  // `models` carries residency (expiresAt is Ollama-only; loaded is the flag).
  // `nowMs` ticks each second so Ollama's countdown stays live between polls.
  type Backend = "ollama" | "lmstudio" | null;
  const [power, setPower] = useState<{ backend: Backend; models: { name: string; expiresAt: string | null; loaded: boolean }[] }>({ backend: null, models: [] });
  const [nowMs, setNowMs] = useState(0);
  const [powerOpen, setPowerOpen] = useState(false);
  const [powerBusy, setPowerBusy] = useState(false);
  // Header overflow menu (clear conversation, context viewer).
  const [menuOpen, setMenuOpen] = useState(false);
  // Inline rename via the room-title pill above the messages.
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

  // Load persisted config + conversations (migrating the old single-chat format)
  useEffect(() => {
    storage.getItem(storageKey).then(async saved => {
      let convs: Conversation[] = [];
      let active = "";
      let chars: Character[] = [];
      let activeChar = DEFAULT_CHARACTER_ID;
      let cfg: ChatConfig = DEFAULT_CONFIG;
      if (saved) {
        try {
          const parsed: ChatState = JSON.parse(saved);
          cfg = { ...DEFAULT_CONFIG, ...parsed.config };
          if ((cfg.sourcesVersion ?? 1) < 2) {
            // v1 had a master useDashboard switch with missing-key = included;
            // v2 is explicit per-widget opt-in. Materialize the old semantics.
            const roster = await listDashboardWidgets().catch(() => [] as WidgetRosterItem[]);
            const explicit: Record<string, boolean> = {};
            for (const w of roster) {
              explicit[w.id] = w.type === "calendar"
                ? !!cfg.useCalendar
                : (cfg.useDashboard ? cfg.dashboardWidgets[w.id] !== false : false);
            }
            cfg = { ...cfg, dashboardWidgets: explicit, sourcesVersion: 2 };
          }
          setConfig(cfg);
          configRef.current = cfg; // before refreshContext, so the gather respects saved choices
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
  }, [storageKey]);

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
    setAdvancedOpen(false);
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
  }

  function clearChat() {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages([]);
    setError("");
    persist(config, []);
  }

  // Resolve a calendar proposal: only a user click here ever creates the event.
  async function resolveProposal(msgIndex: number, propIndex: number, accept: boolean) {
    const msg = messages[msgIndex];
    const prop = msg?.proposals?.[propIndex];
    if (!prop || prop.status !== "pending") return;
    let status: Proposal["status"] = "dismissed";
    if (accept) {
      // Calendar writes go to a real CalDAV server, outside the demo sandbox.
      if (isDemoMode()) { status = "failed"; }
      else if (!calSource) { status = "failed"; }
      else {
        try {
          const res = await fetch("/api/caldav", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              op: "create",
              baseUrl: calSource.account.baseUrl,
              username: calSource.account.username,
              password: calSource.account.password,
              calendar: { name: prop.calendarName, url: prop.calendarUrl },
              event: { title: prop.title, start: prop.start, end: prop.end, location: prop.location, description: prop.description },
            }),
          });
          status = res.ok ? "added" : "failed";
        } catch { status = "failed"; }
      }
    }
    const next = messages.map((m, i) =>
      i === msgIndex
        ? { ...m, proposals: m.proposals!.map((pr, j) => (j === propIndex ? { ...pr, status } : pr)) }
        : m
    );
    setMessages(next);
    persist(config, next);
  }

  // Flip one widget's data access; invalidate the cached gather so the next
  // message (or refresh) rebuilds with the new allowlist.
  function toggleWidgetAccess(id: string) {
    const next = {
      ...config,
      sourcesVersion: 2,
      dashboardWidgets: { ...config.dashboardWidgets, [id]: !config.dashboardWidgets[id] },
    };
    setConfig(next);
    configRef.current = next;
    persist(next, messages);
  }

  function toggleKiwix() {
    const next = { ...config, useKiwix: !config.useKiwix };
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
      generate([...messages.slice(0, i), { role: "user", content: text, at: Date.now() }]);
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

  // The + always opens a fresh room with the default Assistant; talking to a
  // character is an explicit choice made through the avatar.
  function newChat() {
    setActiveCharacterId(DEFAULT_CHARACTER_ID);
    activeCharacterIdRef.current = DEFAULT_CHARACTER_ID;
    newChatWith(DEFAULT_CHARACTER_ID);
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

  // Same persona and focus, fresh memory: a clone for a separate context
  // (e.g. one study coach per class). Opens its editor for renaming.
  function duplicateCharacter(src: Character) {
    const ch: Character = {
      id: newId(),
      name: `${src.name} (copy)`,
      emoji: src.id === DEFAULT_CHARACTER_ID ? "\u{1F916}" : src.emoji,
      persona: src.id === DEFAULT_CHARACTER_ID ? config.system : src.persona,
      focus: src.focus,
      memories: [],
    };
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
  function buildSystemContent(dash: WidgetRosterItem[] | null): string {
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
    if (dash?.length) {
      const todayStr = new Date().toISOString().split("T")[0];
      parts.push(
        `The user has turned on dashboard access. Today is ${todayStr}. You can read their dashboard through two tools:\n` +
        `- read_widget(id): read one widget's current content. The tool description lists every widget available right now (their notes, feeds, tracker, headlines...). Long content comes back in parts; use find="keywords" to jump to matching sections or page=N to read sequentially.\n` +
        `- search_dashboard(query): keyword-search across ALL widgets at once, when you don't know which widget holds the answer.\n\n` +
        `When the user asks about their notes, what they wrote, their tracked time, or what's new in the things they follow, use these tools rather than guessing. ` +
        `When the user mentions a widget with @ (like "@Tracker"), they are pointing you at that widget: read it. ` +
        `Typical flow: for "what's new on X" read that widget directly; for "where did I mention Y" search the dashboard first, then read the matching widget for context. ` +
        `Notes are the user's own writing: quote them faithfully, with their dates. ` +
        `What the tools return is everything you can see. If the answer isn't there, say so plainly rather than inventing entries.`
      );
    }
    if (calendarOn) {
      parts.push(
        `You can read and write the user's calendar through list_calendar_events and create_calendar_event. ` +
        `Use list_calendar_events for any question about their schedule, free time, or upcoming events; today's date is ${new Date().toISOString().split("T")[0]}. ` +
        `create_calendar_event NEVER writes directly: it shows the user a confirmation card and they decide. Only propose an event when the user explicitly asks to add or schedule something, and afterwards tell them it awaits their confirmation. ` +
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

  // After a reply, quietly revise this character's memory from the exchange:
  // add facts the user stated, update memories they corrected, remove ones they
  // retracted. Runs only for characters with a focus. Fire-and-forget; a second,
  // non-streaming model call that never blocks the reply.
  async function extractMemories(character: Character, userMsg: string, reply: string) {
    if (!character.focus.trim() || !configured || !userMsg.trim() || !reply.trim()) return;
    try {
      const current = charactersRef.current.find(ch => ch.id === character.id);
      if (!current) return;
      const memList = current.memories.length
        ? current.memories.map((m, i) => `${i + 1}. ${m}`).join("\n")
        : "(none)";
      const sys =
        `You maintain the long-term memory of "${character.name}", an assistant focused on: ${character.focus.trim()}.\n` +
        `Current memories:\n${memList}\n\n` +
        `From the exchange below, decide how the memory should change:\n` +
        `- "add": NEW durable facts ABOUT THE USER, relevant to the focus, that they explicitly stated in THIS exchange. Keep their wording for specifics (dates, scores, names); never infer, embellish, or merge with existing memories.\n` +
        `- "update": when the user corrects or supersedes a numbered memory, map its number to the corrected text (e.g. they say a score was actually different).\n` +
        `- "remove": numbers of memories the user retracted, declared no longer true, or asked you to forget or disregard.\n` +
        `Ignore off-topic content, transient details, and the assistant's own statements. Never touch memories unrelated to this exchange. ` +
        `A correction is an update ONLY, never also an add. Never add a fact that overlaps or duplicates an existing or updated memory; fold it into the update instead. Every "add" entry must be a complete sentence about the user, never a bare number or fragment.\n` +
        `Output ONLY JSON in this shape: {"add":["fact"],"update":{"2":"corrected fact"},"remove":[3]} - use empty values when nothing changes.`;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, stream: false, maxTokens: 350,
          // Reasoning would eat the whole token budget and starve the JSON
          // output; disable it on local backends (hosted APIs reject the param).
          reasoningEffort: /(openai|anthropic|googleapis|mistral|groq)\.com/i.test(config.baseUrl) ? "" : "none",
          messages: [{ role: "system", content: sys }, { role: "user", content: `User: ${userMsg}\nAssistant: ${reply}` }],
        }),
      });
      if (!res.ok) return;
      const raw = stripThinking(String((await res.json()).content ?? ""));
      // Accept the op object, or a bare array (treated as adds) from models
      // that fall back to the old shape.
      let ops: { add?: unknown; update?: unknown; remove?: unknown } = {};
      const oA = raw.indexOf("{"), oB = raw.lastIndexOf("}");
      const aA = raw.indexOf("["), aB = raw.lastIndexOf("]");
      try {
        if (oA !== -1 && oB > oA) ops = JSON.parse(raw.slice(oA, oB + 1));
        else if (aA !== -1 && aB > aA) ops = { add: JSON.parse(raw.slice(aA, aB + 1)) };
        else return;
      } catch { return; }

      const fresh = charactersRef.current.find(ch => ch.id === character.id);
      if (!fresh) return;
      const baseMems = fresh.memories;
      const sane = (v: unknown) => {
        const t = String(v ?? "").trim();
        return t.length > 1 && t.length < 200 ? t : "";
      };
      const updates: Record<number, string> = {};
      if (ops.update && typeof ops.update === "object" && !Array.isArray(ops.update)) {
        for (const [k, v] of Object.entries(ops.update as Record<string, unknown>)) {
          const idx = parseInt(k);
          const text = sane(v);
          if (idx >= 1 && idx <= baseMems.length && text && text !== baseMems[idx - 1]) updates[idx] = text;
        }
      }
      const removals = new Set(
        (Array.isArray(ops.remove) ? ops.remove : [])
          .map(n => parseInt(String(n)))
          .filter(n => n >= 1 && n <= baseMems.length && !updates[n])
      );
      const changes: string[] = [];
      let nextMems: string[] = [];
      baseMems.forEach((m, i) => {
        const n = i + 1;
        if (removals.has(n)) { changes.push(`forgot: ${m}`); return; }
        if (updates[n]) { changes.push(`updated: ${updates[n]}`); nextMems.push(updates[n]); return; }
        nextMems.push(m);
      });
      const have = new Set(nextMems.map(m => m.toLowerCase()));
      const updatedTexts = Object.values(updates).map(t => t.toLowerCase());
      for (const f of (Array.isArray(ops.add) ? ops.add : [])) {
        const text = sane(f);
        // Reject fragments: a memory needs words, not a stray number, and an
        // add that is contained in an update is the same correction twice.
        if (!/[a-zA-Z]/.test(text) || text.split(/\s+/).length < 2) continue;
        if (updatedTexts.some(u => u.includes(text.toLowerCase()))) continue;
        // Semantic near-duplicate: if almost all of the add's significant words
        // already live in one memory, it is the same fact reworded.
        const words = text.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? [];
        const dupe = words.length > 0 && [...nextMems].some(m => {
          const mw = new Set(m.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []);
          return words.filter(w => mw.has(w)).length / words.length >= 0.8;
        });
        if (dupe) continue;
        if (text && !have.has(text.toLowerCase())) {
          have.add(text.toLowerCase());
          nextMems.push(text);
          changes.push(`remembered: ${text}`);
        }
      }
      if (!changes.length) return;
      nextMems = nextMems.slice(-40); // cap memory size
      const next = charactersRef.current.map(ch =>
        ch.id === character.id ? { ...ch, memories: nextMems } : ch
      );
      setCharacters(next);
      persistCharacters(next, activeCharacterIdRef.current);
      // Surface what changed as permanent text on the reply that caused it.
      const convId = activeIdRef.current;
      const attach = (msgs: ChatMessage[]): ChatMessage[] => {
        const idx = msgs.map(m => m.role).lastIndexOf("assistant");
        if (idx === -1) return msgs;
        return msgs.map((m, i) => (i === idx ? { ...m, memory: [...(m.memory ?? []), ...changes] } : m));
      };
      const convs = conversationsRef.current.map(cv => (cv.id === convId ? { ...cv, messages: attach(cv.messages) } : cv));
      conversationsRef.current = convs;
      setConversations(convs);
      persistConversations(configRef.current, convs, activeIdRef.current);
      if (convId === activeIdRef.current) setMessages(prev => attach(prev));
    } catch { /* memory is best-effort */ }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pendingImages.length) || streaming || !configured) return;
    const images = pendingImages.length ? [...pendingImages] : undefined;
    setError("");
    setInput("");
    setPendingImages([]);
    await generate([...messages, { role: "user", content: text, at: Date.now(), ...(images ? { images } : {}) }]);
  }

  // Stream an assistant reply for a history ending in a user message. Shared by
  // send(), editing a user message, and continuing a cut-off reply (which
  // streams into the existing last assistant message, tools disabled).
  async function generate(history: ChatMessage[], opts?: { continueFrom?: { base: string } }) {
    const cont = opts?.continueFrom;
    timingRef.current = { start: performance.now(), first: null };
    atBottomRef.current = true; // follow the new turn
    setStreaming(true);

    // Only the roster travels with the request; widget content is fetched
    // server-side when the model explicitly reads a widget. An @-mention in
    // the message force-includes that widget even when its toggle is off.
    const lastUserText = [...history].reverse().find(m => m.role === "user")?.content ?? "";
    const wantsRoster = anySourceOn || lastUserText.includes("@");
    const rosterNow = wantsRoster && !cont ? await listDashboardWidgets().catch(() => [] as WidgetRosterItem[]) : [];
    const dash = rosterNow.filter(w =>
      config.dashboardWidgets[w.id] === true || lastUserText.includes(`@${w.title}`)
    );

    // Continuation streams into the existing message; otherwise append a placeholder.
    setMessages(cont ? [...history] : [...history, { role: "assistant", content: "" }]);

    // Only role/content go upstream. Strip prior assistant <think>…</think>
    // reasoning — replaying it wastes the context window (and reasoning models
    // expect history without it), which otherwise crowds out the conversation.
    const systemContent = buildSystemContent(dash);
    const continueNudge: { role: Role; content: string }[] = cont
      ? [{ role: "user", content: "Continue your previous answer exactly where it left off. Do not repeat or summarize earlier text; just continue." }]
      : [];
    const cleanHistory = history.map(m => {
      const text = m.role === "assistant" ? m.content.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim() : m.content;
      // Images ride as OpenAI-style content parts; plain messages stay strings.
      if (m.images?.length) {
        return {
          role: m.role,
          content: [
            ...(text ? [{ type: "text", text }] : []),
            ...m.images.map(url => ({ type: "image_url", image_url: { url } })),
          ],
        };
      }
      return { role: m.role, content: text };
    });
    const payload = [
      ...(systemContent ? [{ role: "system", content: systemContent }] : []),
      ...cleanHistory,
      ...continueNudge,
    ];

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
          kiwix: !cont && config.useKiwix && config.kiwixUrl
            ? { baseUrl: config.kiwixUrl } // no source: search every book on the server
            : null,
          anytype: !cont && config.useAnytype && config.anytypeUrl && config.anytypeApiKey && config.anytypeSpaceId
            ? { baseUrl: config.anytypeUrl, apiKey: config.anytypeApiKey, spaceId: config.anytypeSpaceId, spaceName: config.anytypeSpaceName }
            : null,
          dashboard: dash.length
            ? { widgets: dash.map(w => ({ id: w.id, title: w.title, type: w.type })) }
            : null,
          caldav: !cont && calendarOn ? calSource!.account : null,
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
          next[next.length - 1] = { ...next[next.length - 1], content: (cont?.base ?? "") + body };
          return next;
        });
      }

      const body = bodyOf(acc);
      const sep = acc.indexOf("\x1e");
      let tokens = 0;
      let sources: Source[] | undefined;
      let proposals: Proposal[] | undefined;
      if (sep !== -1) {
        try {
          const trailer = JSON.parse(acc.slice(sep + 1));
          tokens = trailer.tokens ?? 0;
          if (Array.isArray(trailer.sources) && trailer.sources.length) sources = trailer.sources;
          if (Array.isArray(trailer.proposals) && trailer.proposals.length) {
            proposals = trailer.proposals.map((pr: Omit<Proposal, "status">) => ({ ...pr, status: "pending" as const }));
          }
        } catch {}
      }
      const end = performance.now();
      const { start, first } = timingRef.current;
      const ttft = first ? (first - start) / 1000 : 0;
      const genS = first ? (end - first) / 1000 : (end - start) / 1000;
      const stats: MsgStats | undefined = tokens > 0
        ? { tokens, ttft, total: (end - start) / 1000, tps: genS > 0 ? tokens / genS : 0 }
        : undefined;

      const finalMessages: ChatMessage[] = cont
        ? [...history.slice(0, -1), {
            ...history[history.length - 1],
            content: cont.base + body,
            stats: stats && history[history.length - 1].stats
              ? { ...stats, tokens: stats.tokens + (history[history.length - 1].stats!.tokens ?? 0) }
              : stats ?? history[history.length - 1].stats,
          }]
        : [...history, { role: "assistant", content: body, at: Date.now(), stats, sources, ...(proposals ? { proposals } : {}) }];
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
          const last = prev[prev.length - 1];
          const next = last?.content === ""
            ? prev.slice(0, -1)
            : [...prev.slice(0, -1), { ...last, at: last.at ?? Date.now() }];
          queueMicrotask(() => persist(config, next));
          return next;
        });
      } else {
        const raw = String(err instanceof Error ? err.message : err);
        setError(/image|vision|multimodal|pixel/i.test(raw)
          ? `${config.model} couldn't process the image; it may not support vision. Try another model or remove the image.`
          : raw);
        setMessages(prev => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      pollPower(); // refresh the residency dot right away
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

  return (
    <div className={`rounded-2xl border flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>

      {/* Header — single row, no divider (a border here reads like a tab bar) */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
        <div className={`flex items-center gap-2 min-w-0 ${c.label}`}>
          {/* Identity: avatar + character name open the characters list */}
          <button
            onClick={() => { if (activeCharacter) { setEditingCharId(activeCharacter.id); setCharDraft({ ...activeCharacter }); } }}
            title={activeCharacter ? `${activeCharacter.name}: settings and memories` : "Character settings"}
            className="shrink-0 w-7 h-7 rounded-lg bg-black/5 dark:bg-white/10 flex items-center justify-center text-base leading-none hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
          >
            {activeCharacter && activeCharacter.id !== DEFAULT_CHARACTER_ID ? activeCharacter.emoji : <Bot size={15} className="opacity-60" />}
          </button>
          <span className="flex flex-col min-w-0 leading-tight">
            <button
              onClick={() => setCharactersOpen(true)}
              title="Switch character"
              className="flex items-center gap-0.5 text-xs font-medium min-w-0 text-left hover:opacity-80"
            >
              <span className="truncate">{activeCharacter?.name ?? "Assistant"}</span>
              <ChevronDown size={11} className="shrink-0 opacity-50" />
            </button>
            {/* Live status: residency dot first (the signal), model name truncates.
                Separate tap target from the identity above. */}
            <span className="relative flex items-center min-w-0">
              {powerCapable ? (
                <button
                  onClick={e => { e.stopPropagation(); setPowerOpen(o => !o); }}
                  title={isLoaded ? `Model loaded on ${backend}: click to control how long it stays` : "Model not loaded: click for options"}
                  className="flex items-center gap-1 min-w-0 -my-0.5 py-0.5 text-[10px] opacity-60 hover:opacity-100 transition-opacity"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLoaded ? "bg-emerald-500" : "bg-current opacity-40"}`} />
                  <span className="shrink-0">
                    {isLoaded ? (pinned ? "ready · ∞" : hasCountdown ? `ready · ${fmtRemaining(remainingMs)}` : "ready") : "asleep"}
                  </span>
                  {config.model && <span className="truncate opacity-70">&nbsp;· {config.model}</span>}
                </button>
              ) : (
                <span className="text-[10px] opacity-45 truncate">{config.model}</span>
              )}
              {powerOpen && powerCapable && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setPowerOpen(false)} />
                  <div className={`absolute left-0 top-5 z-50 w-44 rounded-xl border ${c.border} ${c.bg} shadow-lg p-2.5 flex flex-col gap-2`}>
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
            </span>
          </span>
        </div>
        {!settingsOpen && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button onClick={newChat} title="New chat with the Assistant" className={actionCls}>
              <Plus size={15} />
            </button>
            <button onClick={() => setHistoryOpen(true)} title="Chats" className={actionCls}>
              <MessageSquare size={14} />
            </button>
            <button onClick={openSettings} title="Settings" className={actionCls}>
              <Pencil size={14} />
            </button>
            <div className="relative">
              <button onClick={() => { if (!menuOpen) listDashboardWidgets().then(setRoster).catch(() => {}); setMenuOpen(o => !o); }} title="More" className={menuOpen ? `opacity-90 ${c.icon}` : actionCls}>
                <EllipsisVertical size={14} />
              </button>
              {menuOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className={`absolute right-0 top-6 z-50 w-60 rounded-xl border ${c.border} ${c.bg} shadow-lg p-1 flex flex-col`}>
                    <p className={`px-2.5 pt-1.5 pb-1 text-[9px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-40 ${c.label}`}>Data access</p>
                    {/* One row per data-bearing widget on the dashboard; no master
                        switch. A calendar widget's row also grants its tools. */}
                    {roster.length === 0 && (
                      <p className={`px-2.5 py-1.5 text-[11px] opacity-40 ${c.text}`}>No data widgets on this dashboard.</p>
                    )}
                    {roster.map(w => {
                      const isCal = w.type === "calendar";
                      const ready = !isCal || calSource?.widgetId === w.id;
                      const on = !!config.dashboardWidgets[w.id];
                      return (
                        <button
                          key={w.id}
                          onClick={() => { if (ready) toggleWidgetAccess(w.id); }}
                          title={!ready ? "Configure the Calendar widget first" : on ? "On: click to turn off" : "Off: click to turn on"}
                          className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg text-xs hover:bg-black/5 dark:hover:bg-white/5 ${c.text} ${ready ? "" : "opacity-40"}`}
                        >
                          {isCal ? <CalendarDays size={13} className={`shrink-0 opacity-60 ${c.label}`} /> : <Database size={13} className={`shrink-0 opacity-60 ${c.label}`} />}
                          <span className="flex-1 min-w-0 truncate">
                            {w.title}
                            <span className={`ml-1.5 text-[10px] opacity-50 ${c.label}`}>{isCal ? "agenda + add events" : w.type}</span>
                          </span>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on && ready ? "bg-emerald-500" : "bg-current opacity-20"}`} />
                        </button>
                      );
                    })}
                    <p className={`px-2.5 pt-2 pb-1 text-[9px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-40 border-t ${c.border} mt-1 ${c.label}`}>Connections</p>
                    {([
                      { icon: Library, label: "Kiwix library", caption: "all books", on: config.useKiwix, ready: !!config.kiwixUrl, toggle: toggleKiwix, hint: "set up in settings" },
                      { icon: Layers, label: "Anytype", caption: config.anytypeSpaceName || "", on: config.useAnytype, ready: !!(config.anytypeApiKey && config.anytypeSpaceId), toggle: toggleAnytype, hint: "pair in settings" },
                    ] as const).map(row => (
                      <button
                        key={row.label}
                        onClick={() => {
                          if (row.ready) { row.toggle(); return; } // stays open for multi-toggling
                          setMenuOpen(false);
                          openSettings();
                        }}
                        title={row.ready ? (row.on ? "On: click to turn off" : "Off: click to turn on") : row.hint}
                        className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg text-xs hover:bg-black/5 dark:hover:bg-white/5 ${c.text} ${row.ready ? "" : "opacity-40"}`}
                      >
                        <row.icon size={13} className={`shrink-0 opacity-60 ${c.label}`} />
                        <span className="flex-1 min-w-0 truncate">
                          {row.label}
                          {row.caption && <span className={`ml-1.5 text-[10px] opacity-50 ${c.label}`}>{row.caption}</span>}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.on && row.ready ? "bg-emerald-500" : "bg-current opacity-20"}`} />
                      </button>
                    ))}
                    <div className={`my-1 border-t ${c.border} opacity-60`} />
                    <button
                      onClick={() => { setMenuOpen(false); clearChat(); }}
                      disabled={messages.length === 0}
                      className="text-left px-2.5 py-2 rounded-lg text-xs text-red-500 dark:text-red-400 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30"
                    >
                      Clear conversation
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>


      {/* Chats list — switches the whole widget to a list of saved conversations */}
      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {historyOpen && (
        <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col ${c.bg}`}>
          <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
            <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
              <MessageSquare size={13} />
              Chats
            </span>
            <div className="flex items-center gap-3">
              <button onClick={newChat} title="New chat with the Assistant" className={`opacity-60 hover:opacity-100 ${c.label}`}>
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
                  <button onClick={e => { e.stopPropagation(); duplicateCharacter(ch); }} title="Duplicate: same persona, fresh memory" className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}><Copy size={12} /></button>
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
              <button
                onClick={() => setAdvancedOpen(o => !o)}
                className={`flex items-center gap-1 text-xs opacity-50 hover:opacity-80 ${c.label}`}
              >
                <ChevronRight size={11} className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
                Advanced
                <span className="opacity-60">
                  (cap: {draft.maxTokens ? `${draft.maxTokens} tokens` : "none"}{draft.maxTokens !== LENGTH_PRESETS[draft.length].cap ? ", custom" : ""})
                </span>
              </button>
              {advancedOpen && (<div className="mt-1.5">
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Max response length <span className="opacity-60">(tokens, 0 = no limit; style presets set this)</span></p>
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
              </div>)}
            </div>

            <p className={`text-[10px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-50 mt-1 ${c.label}`}>Data sources</p>

            <p className={`text-[10px] -mt-1 opacity-45 ${c.label}`}>Connections are set up here; what the model may access is chosen per chat from the ⋮ menu.</p>

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
                  hover and click the pencil to connect a local or OpenAI-compatible model
                </p>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState c={c}>ask anything</EmptyState>
            ) : (
              <>
              {/* Room title: quiet pill; click to rename in place */}
              <div className="self-center shrink-0">
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
                    className={`px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest text-center font-[family-name:var(--font-dm-mono)] bg-transparent border border-[var(--surface-border)] outline-none w-44 ${c.label}`}
                  />
                ) : (
                  <button
                    onClick={() => { setTitleDraft(activeConv?.renamed ? activeConv.title : ""); setEditingTitle(true); }}
                    title="Rename this chat"
                    className={`px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-35 hover:opacity-70 transition-opacity ${c.label}`}
                  >
                    {chatTitle}
                  </button>
                )}
              </div>
              {messages.map((m, i) => {
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
                let lastDatedAt: number | null = null;
                for (let j = i - 1; j >= 0; j--) {
                  const a = messages[j].at;
                  if (a != null) { lastDatedAt = a; break; }
                }
                const daySep = m.at != null && (lastDatedAt == null || msgDayLabel(lastDatedAt) !== msgDayLabel(m.at))
                  ? msgDayLabel(m.at) : null;
                return (
                  <Fragment key={i}>
                  {daySep && (
                    <div className="self-center my-1">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-40 ${c.label} bg-black/5 dark:bg-white/10`}>
                        {daySep}
                      </span>
                    </div>
                  )}
                  <div className={`flex flex-col gap-0.5 group/msg ${m.role === "user" ? "items-end" : "items-start"}`}>
                    {(m.images?.length ?? 0) > 0 && (
                      <div className="max-w-[85%] flex flex-wrap gap-1.5 justify-end">
                        {m.images!.map((src, k) => (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            key={k}
                            src={src}
                            alt="attachment"
                            onClick={() => setLightbox(src)}
                            className="max-h-36 max-w-full rounded-xl border border-[var(--surface-border)] cursor-zoom-in"
                          />
                        ))}
                      </div>
                    )}
                    {!(m.role === "assistant" && !m.content) && !(m.role === "user" && !m.content) && (
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words ${
                          m.role === "user"
                            ? "whitespace-pre-wrap bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-primary)] shadow-sm"
                            : `${c.text} opacity-90`
                        }`}
                      >
                        {m.role === "assistant" ? renderAssistant(m.content, inProgress, c.label, m.sources) : m.content}
                      </div>
                    )}
                    {!inProgress && m.role === "assistant" && m.sources && m.sources.length > 0 && (
                      <SourcesList sources={m.sources} labelClass={c.label} textClass={c.text} />
                    )}
                    {!inProgress && m.role === "assistant" && (m.proposals?.length ?? 0) > 0 && (
                      <div className="flex flex-col gap-1.5 max-w-[85%]">
                        {m.proposals!.map((pr, j) => (
                          <div key={j} className={`rounded-xl border ${c.border} bg-[var(--surface)] px-3 py-2 flex flex-col gap-1`}>
                            <span className="flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
                              <CalendarDays size={12} className={`shrink-0 ${c.label}`} />
                              <span className="font-medium truncate">{pr.title}</span>
                            </span>
                            <span className="text-[11px] text-[var(--text-secondary)]">
                              {pr.start.replace("T", " ")}{pr.end ? ` to ${pr.end.replace("T", " ")}` : ""} · {pr.calendarName}
                              {pr.location ? ` · ${pr.location}` : ""}
                            </span>
                            {pr.status === "pending" ? (
                              <span className="flex items-center gap-2 mt-0.5">
                                <button
                                  onClick={() => resolveProposal(i, j, true)}
                                  className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600/90 text-white hover:bg-emerald-600"
                                >
                                  Add to calendar
                                </button>
                                <button
                                  onClick={() => resolveProposal(i, j, false)}
                                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[var(--surface-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                >
                                  Dismiss
                                </button>
                              </span>
                            ) : (
                              <span className={`text-[10px] ${pr.status === "added" ? "text-emerald-600 dark:text-emerald-400" : pr.status === "failed" ? "text-red-500" : "opacity-50 text-[var(--text-secondary)]"}`}>
                                {pr.status === "added" ? "added to calendar" : pr.status === "failed" ? (isDemoMode() ? "not available in demo mode" : "could not add (check the calendar widget)") : "dismissed"}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!inProgress && m.role === "assistant" && (m.memory?.length ?? 0) > 0 && (
                      <button
                        onClick={() => {
                          const ch = characters.find(x => x.id === (activeConv?.characterId ?? activeCharacterId));
                          if (ch) { setEditingCharId(ch.id); setCharDraft({ ...ch }); }
                        }}
                        title="Open this character's memories"
                        className={`flex flex-col items-start gap-0.5 px-1 text-left opacity-55 hover:opacity-90 transition-opacity ${c.label}`}
                      >
                        {m.memory!.map((line, k) => (
                          <span key={k} className="flex items-center gap-1 text-[10px]">
                            <Brain size={10} className="shrink-0" />
                            <span className="truncate max-w-[260px]">{line}</span>
                          </span>
                        ))}
                      </button>
                    )}
                    {inProgress && (() => {
                      // Honest status: residency-aware before the first byte,
                      // trail-aware while a think block is open (tool activity
                      // is "researching", chain-of-thought is "thinking"),
                      // and a quiet typing indicator once the answer flows.
                      if (!m.content) {
                        const label = powerCapable ? (isLoaded ? "processing" : "loading model") : "waiting for model";
                        return <span className={`px-1 text-[10px] ${c.text} opacity-45`}>{label}… {secs.toFixed(1)}s</span>;
                      }
                      const openIdx = m.content.lastIndexOf("<think>");
                      if (openIdx > m.content.lastIndexOf("</think>")) {
                        const tail = m.content.slice(openIdx);
                        const researching = /\u{1F50E}|\u{1F4D6}|\u{1F4CA}|\u{1F9E9}|checking calendar|adding "/u.test(tail);
                        return (
                          <span className={`px-1 text-[10px] ${c.text} opacity-45`}>
                            {researching ? "researching" : "thinking"}… {secs.toFixed(1)}s
                          </span>
                        );
                      }
                      return (
                        <span className="px-1 flex items-center gap-1" aria-label="typing">
                          {[0, 1, 2].map(j => (
                            <span
                              key={j}
                              className={`w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse ${c.text}`}
                              style={{ animationDelay: `${j * 200}ms` }}
                            />
                          ))}
                        </span>
                      );
                    })()}
                    <div className="flex items-center gap-2 px-1">
                      {!inProgress && m.at != null && (
                        <span className={`text-[9px] tabular-nums ${c.text} opacity-35`}>{msgTime(m.at)}</span>
                      )}
                      {!inProgress && m.role === "assistant" && m.stats && m.stats.tokens > 0 && (
                        <span className={`text-[10px] ${c.text} opacity-0 group-hover/msg:opacity-40 [@media(hover:none)]:opacity-40 transition-opacity`}>
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
                      {canEdit && m.role === "assistant" && i === messages.length - 1 && (
                        <button
                          onClick={() => generate([...messages], { continueFrom: { base: m.content } })}
                          title="Continue this reply where it left off"
                          className={`opacity-0 group-hover/msg:opacity-50 [@media(hover:none)]:!opacity-50 hover:!opacity-90 ${c.icon}`}
                        >
                          <ChevronsRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  </Fragment>
                );
              })}
              </>
            )}
            {error && <p className="text-red-400 text-xs">{error}</p>}
          </div>

          {/* Pending image attachments */}
          {pendingImages.length > 0 && (
            <div className={`shrink-0 px-3 pb-1.5 flex items-center gap-2`}>
              {pendingImages.map((src, k) => (
                <div key={k} className="relative group/img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt="pending attachment"
                    onClick={() => setLightbox(src)}
                    className="h-12 w-12 object-cover rounded-lg border border-[var(--surface-border)] cursor-zoom-in"
                  />
                  <button
                    onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== k))}
                    title="Remove"
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[10px] leading-none shadow-sm"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* @-mention picker */}
          {mention && mentionMatches.length > 0 && (
            <div className="relative shrink-0">
              <div className={`absolute bottom-1.5 left-3 right-3 z-30 rounded-xl border ${c.border} bg-[var(--surface)] shadow-lg p-1 flex flex-col`}>
                {mentionMatches.map((w, k) => (
                  <button
                    key={w.id}
                    onMouseDown={e => { e.preventDefault(); insertMention(w); }}
                    onMouseEnter={() => setMentionIdx(k)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left ${
                      k === mentionIdx ? "bg-black/5 dark:bg-white/10" : ""
                    } text-[var(--text-primary)]`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tagColor(w.type).dot }} />
                    <span className="flex-1 min-w-0 truncate">{w.title}</span>
                    <span className="text-[10px] opacity-50">{w.type}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Composer */}
          <div className={`shrink-0 p-2.5 border-t ${c.border}`}>
            <div className="flex items-end gap-2 bg-[var(--surface)] rounded-2xl border border-[var(--surface-border)] px-3 py-1.5">
              <textarea
                ref={composerRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onKeyDown={e => {
                  if (mention && mentionMatches.length) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx(i => (i + 1) % mentionMatches.length); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx(i => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionMatches[mentionIdx]); return; }
                    if (e.key === "Escape") { setMention(null); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                onBlur={() => setTimeout(() => setMention(null), 150)}
                onPaste={e => {
                  const files = [...e.clipboardData.items]
                    .filter(it => it.kind === "file" && it.type.startsWith("image/"))
                    .map(it => it.getAsFile())
                    .filter((f): f is File => !!f);
                  if (files.length) { e.preventDefault(); attachImages(files); }
                }}
                disabled={!configured || !loaded}
                rows={1}
                placeholder={configured ? "Message…" : "Configure a model first"}
                className="flex-1 resize-none overflow-y-auto text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-transparent py-1 disabled:opacity-50"
              />
              {visionOk !== false && (
                <>
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={!configured || pendingImages.length >= 3}
                    title={pendingImages.length >= 3 ? "Up to 3 images per message" : "Attach an image (or paste one)"}
                    className={`shrink-0 p-1.5 rounded-full disabled:opacity-30 ${c.icon} opacity-55 hover:opacity-100 transition-opacity`}
                  >
                    <Paperclip size={14} />
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files?.length) attachImages(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
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
                  disabled={(!input.trim() && !pendingImages.length) || !configured}
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
