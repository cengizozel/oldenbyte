"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bot, Pencil, Send, Square, Check, X, RotateCcw, RefreshCw, Loader, Database, Eye } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { gatherDashboardContext } from "@/lib/dashboardContext";
import Markdown from "./Markdown";

type Role = "user" | "assistant";
type MsgStats = { tps: number; tokens: number; total: number; ttft: number };
type ChatMessage = { role: Role; content: string; stats?: MsgStats };

type Length = "default" | "concise" | "balanced" | "detailed";

type ChatConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  useDashboard: boolean;
  maxTokens: number; // cap on response length; 0 = no limit (server default)
  length: Length;    // response-style preset: brevity instruction + suggested cap
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
  messages: ChatMessage[];
};

const DEFAULT_CONFIG: ChatConfig = {
  baseUrl: "",
  apiKey: "",
  model: "",
  system: "",
  useDashboard: false,
  maxTokens: 0,
  length: "default",
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

  // Dashboard context — gathered snapshot of the user's notes/feeds, injected
  // when `config.useDashboard` is on. Cached so we don't re-fetch every message.
  const [ctx, setCtx] = useState<{ text: string; chars: number; sections: number } | null>(null);
  const [gathering, setGathering] = useState(false);
  const [showContext, setShowContext] = useState(false);

  // Inline editing of an assistant reply (the persisted conversation is fed back
  // as context, so edits let you curate it).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
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
      const result = await gatherDashboardContext();
      setCtx(result);
      return result;
    } catch {
      const empty = { text: "", chars: 0, sections: 0 };
      setCtx(empty);
      return empty;
    } finally {
      setGathering(false);
    }
  }, []);

  // Load persisted config + conversation
  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) {
        try {
          const parsed: ChatState = JSON.parse(saved);
          const cfg = { ...DEFAULT_CONFIG, ...parsed.config };
          setConfig(cfg);
          setMessages(parsed.messages ?? []);
          if (cfg.useDashboard) refreshContext();
        } catch {}
      }
      setLoaded(true);
    });
  }, [storageKey, refreshContext]);

  const persist = useCallback((cfg: ChatConfig, msgs: ChatMessage[]) => {
    storage.setItem(storageKey, JSON.stringify({ config: cfg, messages: msgs }));
  }, [storageKey]);

  // Keep the view pinned to the latest message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Abort any in-flight stream on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const configured = Boolean(config.baseUrl && config.model);

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
      setModels(data.models ?? []);
      if ((data.models ?? []).length === 0) setModelsError("No models reported by this server.");
      // Auto-select the first model if none chosen yet
      if (!draft.model && data.models?.[0]) setDraft(d => ({ ...d, model: data.models[0] }));
    } catch (err) {
      setModels([]);
      setModelsError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoadingModels(false);
    }
  }

  function openSettings() {
    setDraft(config);
    setModels([]);
    setModelsError("");
    setSettingsOpen(true);
  }

  function saveSettings() {
    const next: ChatConfig = {
      ...draft,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      maxTokens: Math.max(0, Math.floor(draft.maxTokens || 0)),
    };
    setConfig(next);
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

  function toggleDashboard() {
    const next = { ...config, useDashboard: !config.useDashboard };
    setConfig(next);
    persist(next, messages);
    if (next.useDashboard && !ctx) refreshContext();
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
    // Drop stats — the token count/timing no longer describe the edited text.
    const next = messages.map((m, idx) =>
      idx === editingIndex ? { ...m, content: editDraft, stats: undefined } : m
    );
    setMessages(next);
    persist(config, next);
    cancelEdit();
  }

  // Combine the user's system prompt with a snapshot of dashboard data when the
  // toggle is on, so the model can answer questions about the user's own notes
  // and feeds.
  function buildSystemContent(dash: typeof ctx): string {
    const parts: string[] = [BASE_IDENTITY];
    if (config.system.trim()) parts.push(config.system.trim());
    const styleHint = LENGTH_PRESETS[config.length].instruction;
    if (styleHint) parts.push(styleHint);
    if (config.useDashboard && dash?.text) {
      const todayStr = new Date().toISOString().split("T")[0];
      parts.push(
        `The user has turned on dashboard access. Inside <dashboard> below is a live snapshot of their dashboard, captured just now. Today is ${todayStr}.\n\n` +
        `Each section is headed by its source and type in parentheses, and means:\n` +
        `- "Notes": the user's own notepad entries, grouped by date, newest first — their personal writing and memory. Quote them faithfully.\n` +
        `- "Feed", "Reddit", "YouTube", "arXiv", "HF Daily": the latest items from external sources the user follows, newest first, usually with links — the material for "what's new" questions.\n` +
        `- "F1": the upcoming race and current driver standings.\n` +
        `- "Tracker (time spent)": how much time the user has logged per activity, by date.\n` +
        `- "Text": a small custom value the user pinned.\n\n` +
        `Your job is to help the user make sense of their own dashboard: answer questions about their notes and the things they follow, recall what they wrote on a given date, summarize or highlight what's new or notable, and connect related items. ` +
        `Refer to specific dates, titles, and links from the data when relevant. ` +
        `This snapshot is everything you can see — if the answer isn't in it, say so plainly rather than guessing or inventing entries, and don't assume anything beyond what's shown.\n\n` +
        `<dashboard>\n${dash.text}\n</dashboard>`
      );
    }
    return parts.join("\n\n");
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming || !configured) return;

    setError("");
    setInput("");

    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    timingRef.current = { start: performance.now(), first: null };
    setStreaming(true);

    // Make sure dashboard data is gathered before we build the prompt (cached
    // after the first time, so this is instant on subsequent messages).
    const dash = config.useDashboard ? (ctx ?? await refreshContext()) : null;

    // Assistant placeholder we stream tokens into
    setMessages([...history, { role: "assistant", content: "" }]);

    // Only role/content go upstream (strip any per-message stats).
    const systemContent = buildSystemContent(dash);
    const cleanHistory = history.map(m => ({ role: m.role, content: m.content }));
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
          stream: true,
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
      if (sep !== -1) { try { tokens = JSON.parse(acc.slice(sep + 1)).tokens ?? 0; } catch {} }
      const end = performance.now();
      const { start, first } = timingRef.current;
      const ttft = first ? (first - start) / 1000 : 0;
      const genS = first ? (end - first) / 1000 : (end - start) / 1000;
      const stats: MsgStats | undefined = tokens > 0
        ? { tokens, ttft, total: (end - start) / 1000, tps: genS > 0 ? tokens / genS : 0 }
        : undefined;

      const finalMessages: ChatMessage[] = [...history, { role: "assistant", content: body, stats }];
      setMessages(finalMessages);
      persist(config, finalMessages);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Keep whatever streamed so far; drop a trailing empty assistant turn.
        setMessages(prev => {
          const next = prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev;
          persist(config, next);
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

  // Hover-revealed header action icon (matches the other widgets).
  const actionCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`;
  // Dashboard controls stay visible (at a steady opacity) while the mode is on.
  const dashCtrlCls = `${c.icon} opacity-55 hover:opacity-100 transition-opacity`;

  return (
    <div className={`rounded-2xl border flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>

      {/* Header — single row, no divider (a border here reads like a tab bar) */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
        <span className={`flex items-center gap-1.5 text-xs font-medium opacity-60 min-w-0 ${c.label}`}>
          <Bot size={14} className="shrink-0" />
          <span className="truncate">{config.model || "Chat"}</span>
        </span>
        {!settingsOpen && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={toggleDashboard}
              title={config.useDashboard ? "Using dashboard data — click to turn off" : "Answer using my dashboard data"}
              className={config.useDashboard ? `opacity-90 ${c.label}` : actionCls}
            >
              <Database size={14} />
            </button>
            {config.useDashboard && (
              <button
                onClick={() => setShowContext(true)}
                disabled={!ctx?.text}
                title="View the data sent to the model"
                className={`${dashCtrlCls} disabled:!opacity-25`}
              >
                <Eye size={14} />
              </button>
            )}
            {config.useDashboard && (
              <button
                onClick={() => refreshContext()}
                disabled={gathering}
                title="Refresh dashboard data"
                className={dashCtrlCls}
              >
                <RefreshCw size={14} className={gathering ? "animate-spin" : ""} />
              </button>
            )}
            {messages.length > 0 && (
              <button onClick={clearChat} title="Clear conversation" className={actionCls}>
                <RotateCcw size={14} />
              </button>
            )}
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
            : ctx?.sections
              ? `using your dashboard · ${ctx.sections} section${ctx.sections === 1 ? "" : "s"} · ~${Math.round(ctx.chars / 1000)}k chars`
              : "using your dashboard · no data found"}
        </div>
      )}

      {/* Context viewer overlay — the full system message sent to the model
          (framing + system prompt + style hint + the <dashboard> data block) */}
      {showContext && (
        <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col ${c.bg}`}>
          <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
            <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
              <Database size={13} />
              Context sent to the model{ctx ? ` · ${ctx.sections} section${ctx.sections === 1 ? "" : "s"} · ~${Math.round(ctx.chars / 1000)}k chars` : ""}
            </span>
            <button onClick={() => setShowContext(false)} title="Close" className={`opacity-50 hover:opacity-90 ${c.label}`}>
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <pre className={`text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono ${c.text} opacity-90`}>
              {buildSystemContent(ctx) || "No context gathered."}
            </pre>
          </div>
        </div>
      )}

      {settingsOpen ? (
        /* Settings panel */
        <div className="flex flex-col gap-3 flex-1 min-h-0 p-4">
          <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-1">

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>API URL</p>
              <input
                autoFocus
                type="url"
                value={draft.baseUrl}
                onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))}
                placeholder="http://localhost:11434/v1"
                className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
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
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>API key <span className="opacity-60">(optional)</span></p>
              <input
                type="password"
                value={draft.apiKey}
                onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
                placeholder="leave blank for local servers"
                className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className={`text-xs opacity-50 ${c.label}`}>Model</p>
                <button
                  onClick={() => fetchModels(draft)}
                  disabled={loadingModels}
                  className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-600 disabled:opacity-40"
                  title="Load models from server"
                >
                  {loadingModels ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Load models
                </button>
              </div>
              <input
                type="text"
                value={draft.model}
                onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
                placeholder="e.g. llama3.2"
                list={`models-${widget.id}`}
                className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
              />
              {models.length > 0 && (
                <datalist id={`models-${widget.id}`}>
                  {models.map(m => <option key={m} value={m} />)}
                </datalist>
              )}
              {models.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {models.slice(0, 8).map(m => (
                    <button
                      key={m}
                      onClick={() => setDraft(d => ({ ...d, model: m }))}
                      className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                        draft.model === m
                          ? "border-[var(--surface-border-focus)] bg-[var(--surface)] text-[var(--text-primary)]"
                          : "border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--surface-border-focus)]"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {modelsError && <p className="text-red-400 text-[11px] mt-1">{modelsError}</p>}
            </div>

            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>System prompt <span className="opacity-60">(optional)</span></p>
              <textarea
                value={draft.system}
                onChange={e => setDraft(d => ({ ...d, system: e.target.value }))}
                placeholder="You are a helpful assistant."
                rows={2}
                className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white resize-none"
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
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Max response length <span className="opacity-60">(tokens, 0 = no limit)</span></p>
              <input
                type="number"
                min={0}
                step={50}
                value={draft.maxTokens || ""}
                onChange={e => setDraft(d => ({ ...d, maxTokens: Number(e.target.value) }))}
                placeholder="0"
                className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
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
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
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
                const canEdit = !streaming && m.role === "assistant" && !!m.content;
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
                            ? <Markdown text={m.content} />
                            : (inProgress ? <span className="inline-block w-2 h-2 rounded-full bg-current opacity-50 animate-pulse" /> : null))
                        : m.content}
                    </div>
                    {inProgress && (
                      <span className={`px-1 text-[10px] ${c.text} opacity-45`}>
                        {m.content ? "generating" : (secs >= 3 ? "loading model / thinking" : "thinking")}… {secs.toFixed(1)}s
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
                          title="Edit reply"
                          className={`opacity-0 group-hover/msg:opacity-50 [@media(hover:none)]:!opacity-50 hover:!opacity-90 ${c.icon}`}
                        >
                          <Pencil size={12} />
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
                className="flex-1 resize-none max-h-24 text-sm outline-none text-neutral-700 placeholder:text-neutral-300 bg-transparent py-1 disabled:opacity-50"
              />
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
