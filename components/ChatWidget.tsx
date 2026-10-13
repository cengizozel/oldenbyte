"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Bot, Pencil, Send, Square, Check, X, Loader, Database, MessageSquare, Plus, ChevronDown, Library, Power, Layers, CalendarDays, EllipsisVertical, Paperclip } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { isDemoMode } from "@/lib/demo";
import { useWidgetActive } from "@/lib/activeDashboard";
import { effectiveTimezone, todayIn, TZ_EVENT } from "@/lib/timezone";
import { listDashboardWidgets, getCalendarAccount, type WidgetRosterItem, type CalendarSource } from "@/lib/dashboardContext";
import { EmptyState } from "./ui/WidgetChrome";
import { tagColor } from "@/lib/colors";
import {
  DEFAULT_CHARACTER_ID, DEFAULT_CONFIG, newId, normalizeProposal, titleFrom,
  type Character, type ChatConfig, type ChatMessage, type ConvMeta, type Proposal,
} from "@/lib/chat/types";
import { daySeparators, fileToDataUrl } from "@/lib/chat/format";
import { createChatSaver, loadChat, loadConversation, metaFor, touchMeta, type ChatIndex } from "@/lib/chat/storage";
import { buildSystemContent } from "@/lib/chat/prompt";
import { applyMemoryOps, requestMemoryOps } from "@/lib/chat/memory";
import { executeProposal } from "@/lib/chat/proposals";
import { replyStats, streamChat, upstreamMessages } from "@/lib/chat/stream";
import { ttlSeconds, useModelResidency } from "@/lib/chat/useModelResidency";
import { useStableCallback } from "@/lib/chat/useStableCallback";
import MessageRow, { type LiveInfo } from "./chat/MessageRow";
import ImageLightbox from "./chat/ImageLightbox";
import HistoryPanel from "./chat/HistoryPanel";
import { CharactersPanel, CharacterEditor } from "./chat/CharactersPanel";
import SettingsPanel from "./chat/SettingsPanel";
import { ResidencyLabel } from "./chat/Timers";

// A reply cut off mid-stream, made ready to keep: drop a trailing empty
// assistant turn, and stamp the last message if it has no time yet.
function settleStreamed(msgs: ChatMessage[]): ChatMessage[] {
  const last = msgs[msgs.length - 1];
  if (!last) return msgs;
  return last.role === "assistant" && last.content === ""
    ? msgs.slice(0, -1)
    : [...msgs.slice(0, -1), { ...last, at: last.at ?? Date.now() }];
}

export default function ChatWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color];
  // False while the widget's dashboard is hidden or the tab is in the
  // background: polling and timers pause, an in-flight stream keeps going.
  const widgetActive = useWidgetActive();

  const [config, setConfig] = useState<ChatConfig>(DEFAULT_CONFIG);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Index entries of the saved conversations; `messages` above is the working
  // copy of the active one.
  const [conversations, setConversations] = useState<ConvMeta[]>([]);
  const [activeId, setActiveId] = useState("");
  // Characters (personas + scoped memory). The active one drives the system
  // prompt for new chats; each conversation remembers which character it used.
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState(DEFAULT_CHARACTER_ID);

  // Ref mirrors for async code and stable handlers. They are written together
  // with their state by the commit helpers, never from inside an updater.
  const configRef = useRef<ChatConfig>(DEFAULT_CONFIG);
  const messagesRef = useRef<ChatMessage[]>([]);
  const conversationsRef = useRef<ConvMeta[]>([]);
  const activeIdRef = useRef("");
  const charactersRef = useRef<Character[]>([]);
  const activeCharacterIdRef = useRef(DEFAULT_CHARACTER_ID);
  const commitConfig = (next: ChatConfig) => { configRef.current = next; setConfig(next); };
  const commitMessages = (next: ChatMessage[]) => { messagesRef.current = next; setMessages(next); };
  const commitConversations = (next: ConvMeta[]) => { conversationsRef.current = next; setConversations(next); };
  const commitActiveId = (id: string) => { activeIdRef.current = id; setActiveId(id); };
  const commitCharacters = (next: Character[]) => { charactersRef.current = next; setCharacters(next); };
  const commitActiveCharacter = (id: string) => { activeCharacterIdRef.current = id; setActiveCharacterId(id); };

  // The character driving the current chat (its conversation's, falling back to active).
  const activeConvCharId = conversations.find(cv => cv.id === activeId)?.characterId ?? activeCharacterId;
  const activeCharacter = characters.find(ch => ch.id === activeConvCharId) ?? characters.find(ch => ch.id === DEFAULT_CHARACTER_ID);
  const [charactersOpen, setCharactersOpen] = useState(false);   // characters list overlay
  const [editingChar, setEditingChar] = useState<Character | null>(null); // editor overlay (null = closed)

  // Timezone preference, so the prompt's date/time matches the user's clock.
  // Kept in a ref read at send time, refreshed if changed in Settings.
  const tzRef = useRef("");
  useEffect(() => {
    storage.getItem("timezone").then(v => { tzRef.current = v ?? ""; });
    const onTz = (e: Event) => { tzRef.current = (e as CustomEvent).detail ?? ""; };
    window.addEventListener(TZ_EVENT, onTz);
    return () => window.removeEventListener(TZ_EVENT, onTz);
  }, []);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Persistence (lib/chat/storage) ─────────────────────────────────────────
  // "failed" = storage could not be read; nothing is saved until a retry
  // succeeds, so a transient failure can never overwrite real chats.
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loaded = loadState === "ready";
  const loadedRef = useRef(false);
  // Messages of the conversations read this session, as last saved. The
  // active one's live copy is `messages`; a different array here means it has
  // unsaved changes.
  const cacheRef = useRef(new Map<string, ChatMessage[]>());
  // Deleted this session: late saves (a stream or memory pass finishing after
  // the delete) must not write them back.
  const deletedRef = useRef(new Set<string>());

  const saver = useMemo(() => createChatSaver(widget.id, {
    index: (): ChatIndex => ({
      config: configRef.current,
      activeId: activeIdRef.current,
      characters: charactersRef.current,
      activeCharacterId: activeCharacterIdRef.current,
      conversations: conversationsRef.current,
    }),
    conversation: id => cacheRef.current.get(id),
    all: () => cacheRef.current,
  }), [widget.id]);

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    setLoadState("loading");
    loadChat(widget.id).then(res => {
      if (cancelled) return;
      if (!res.ok) { setLoadState("failed"); return; }
      const chat = res.chat;
      cacheRef.current = new Map(chat.messages);
      commitConfig(chat.config);
      commitCharacters(chat.characters);
      commitActiveCharacter(chat.activeCharacterId);
      commitConversations(chat.conversations);
      commitActiveId(chat.activeId);
      commitMessages(chat.messages.get(chat.activeId) ?? []);
      saver.setMigrationPending(chat.migrationPending);
      loadedRef.current = true;
      setLoadState("ready");
    });
    return () => { cancelled = true; };
  }, [widget.id, saver, loadAttempt]);

  const saveIndex = () => { if (loadedRef.current) saver.saveIndex(); };

  // Write one conversation's messages as they are (no index change).
  function writeConversation(convId: string, msgs: ChatMessage[]) {
    if (!loadedRef.current || deletedRef.current.has(convId)) return;
    cacheRef.current.set(convId, msgs);
    saver.saveConversation(convId);
  }

  // Save a conversation whose messages changed: its own key, plus its index
  // entry (title, count, time).
  function saveConversation(convId: string, msgs: ChatMessage[]) {
    if (!loadedRef.current || deletedRef.current.has(convId)) return;
    const list = conversationsRef.current;
    commitConversations(list.some(cv => cv.id === convId)
      ? list.map(cv => (cv.id === convId ? touchMeta(cv, msgs) : cv))
      : [...list, metaFor(convId, msgs, { characterId: activeCharacterIdRef.current })]);
    writeConversation(convId, msgs);
    saveIndex();
  }

  function saveConfig(next: ChatConfig) {
    commitConfig(next);
    saveIndex();
  }

  // Save when only the characters / active character changed.
  function saveCharacters(chars: Character[], activeChar: string) {
    commitCharacters(chars);
    commitActiveCharacter(activeChar);
    saveIndex();
  }

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
  // v3 semantics: widgets on the dashboard are readable unless explicitly
  // toggled off, so any roster at all means sources are in play.
  const sourceOn = (id: string) => config.dashboardWidgets[id] !== false;
  const calendarOn = !!(calSource && sourceOn(calSource.widgetId));
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

  const [powerOpen, setPowerOpen] = useState(false);
  const [powerBusy, setPowerBusy] = useState(false);
  // Header overflow menu (clear conversation, context viewer).
  const [menuOpen, setMenuOpen] = useState(false);
  // Inline rename via the room-title pill above the messages.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Inline editing of a message (the persisted conversation is fed back as
  // context, so edits let you curate it).
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
  // When the current response started (performance.now()), for the live
  // elapsed counter under it.
  const [streamStart, setStreamStart] = useState(0);

  // Keep the view pinned to the latest message, but only if the user hasn't
  // scrolled up to read earlier content.
  useEffect(() => {
    if (atBottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Leaving the settings panel remounts the message list at the top: snap back
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
  const residency = useModelResidency(config.baseUrl, config.model, widgetActive);
  const { backend, isLoaded, poll: pollPower, post: postPower } = residency;
  const powerCapable = residency.capable;

  // Choose how long the model lingers. Persists the preference (Ollama re-applies
  // it after each reply; LM Studio sends it as ttl on each request). Picking a
  // duration never force-loads an idle model; only an explicit pin (∞) does.
  async function chooseLinger(value: string, opts?: { load?: boolean }) {
    saveConfig({ ...config, keepAlive: value });
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

  // Evict the model from VRAM right now. One-shot: doesn't change the linger
  // preference, so the next message reloads under whatever you've chosen.
  async function unloadNow() {
    setPowerBusy(true);
    if (backend === "ollama") await postPower({ keepAlive: 0 });
    else if (backend === "lmstudio") await postPower({ action: "unload" });
    await pollPower();
    setPowerBusy(false);
    setPowerOpen(false);
  }

  function openSettings() {
    setSettingsOpen(true);
    // Roster for the data-access menu (names only, no data fetching).
    listDashboardWidgets().then(setRoster).catch(() => setRoster([]));
  }

  function saveSettings(draft: ChatConfig) {
    saveConfig({
      ...draft,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      apiKey: "", // local-only for now; no key is stored (re-enable the field to use hosted providers)
      maxTokens: Math.max(0, Math.floor(draft.maxTokens || 0)),
      kiwixUrl: draft.kiwixUrl.trim(),
    });
    setSettingsOpen(false);
  }

  function clearChat() {
    abortRef.current?.abort();
    setStreaming(false);
    commitMessages([]);
    setError("");
    saveConversation(activeIdRef.current, []);
  }

  // Resolve a write proposal: only a user click here ever executes it.
  async function resolveProposal(msgIndex: number, propIndex: number, accept: boolean) {
    const msg = messagesRef.current[msgIndex];
    const prop = msg?.proposals?.[propIndex];
    if (!prop || prop.status !== "pending") return;
    const convId = activeIdRef.current;
    const p = normalizeProposal(prop);
    let status: Proposal["status"] = "dismissed";
    if (accept) {
      // Writes reach real external services, outside the demo sandbox.
      if (isDemoMode()) { status = "failed"; }
      else {
        try {
          status = (await executeProposal(p, { calSource, config, timezone: tzRef.current })) ? "added" : "failed";
        } catch { status = "failed"; }
      }
    }
    // Patch ONLY the targeted proposal, from the freshest state: a stale
    // snapshot here would roll back other proposals resolved in flight.
    const patch = (msgs: ChatMessage[]): ChatMessage[] =>
      msgs.map((m, i) =>
        i === msgIndex && m.proposals
          ? { ...m, proposals: m.proposals.map((pr, j) => (j === propIndex ? { ...pr, status } : pr)) }
          : m
      );
    if (activeIdRef.current === convId) {
      const next = patch(messagesRef.current);
      commitMessages(next);
      saveConversation(convId, next);
    } else {
      // The user switched chats while the write ran: record the outcome in the
      // original conversation without touching the one on screen.
      const saved = cacheRef.current.get(convId);
      if (saved) writeConversation(convId, patch(saved));
    }
  }

  // Flip one widget's data access.
  function toggleWidgetAccess(id: string) {
    saveConfig({
      ...config,
      sourcesVersion: 3,
      // v3: missing entry = on, so toggling writes the explicit opposite.
      dashboardWidgets: { ...config.dashboardWidgets, [id]: !sourceOn(id) },
    });
  }

  function toggleKiwix() {
    saveConfig({ ...config, useKiwix: !config.useKiwix });
  }

  function toggleAnytype() {
    saveConfig({ ...config, useAnytype: !config.useAnytype });
  }

  function startEdit(i: number) {
    setEditingIndex(i);
    setEditDraft(messagesRef.current[i].content);
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
      // Keep the message's other fields (image attachments especially); only
      // the text was edited.
      generate([...messages.slice(0, i), { ...messages[i], content: text, at: Date.now() }]);
      return;
    }
    // Editing an assistant reply just rewrites its text in place.
    // Drop stats: the token count/timing no longer describe the edited text.
    const next = messages.map((m, idx) =>
      idx === i ? { ...m, content: text, stats: undefined } : m
    );
    commitMessages(next);
    saveConversation(activeIdRef.current, next);
    cancelEdit();
  }

  // Regenerate the reply to a user message: the same effect as editing it and
  // confirming unchanged. Keep everything up to and including it, drop the
  // rest, and rerun from that point.
  function retry(i: number) {
    if (streaming || !configured) return;
    setError("");
    cancelEdit();
    generate(messagesRef.current.slice(0, i + 1));
  }

  // ── Conversations ──────────────────────────────────────────────────────────
  // The list with the active conversation's entry refreshed from the working copy.
  function syncActive(list: ConvMeta[]): ConvMeta[] {
    return list.map(cv => (cv.id === activeIdRef.current ? touchMeta(cv, messagesRef.current) : cv));
  }

  // Messages of a conversation: from memory when read this session, else from
  // storage. null = the read failed (never treat that as an empty chat).
  async function messagesFor(id: string): Promise<ChatMessage[] | null> {
    const cached = cacheRef.current.get(id);
    if (cached) return cached;
    const res = await loadConversation(widget.id, id);
    if (!res.ok) return null;
    cacheRef.current.set(id, res.messages);
    return res.messages;
  }

  // Manually rename a conversation. An empty name reverts to auto-titling.
  function renameChat(id: string, name: string) {
    const t = name.trim();
    commitConversations(conversationsRef.current.map(cv => {
      if (cv.id !== id) return cv;
      const auto = cv.id === activeIdRef.current ? titleFrom(messagesRef.current) : cv.autoTitle;
      return { ...cv, title: t || auto, renamed: t.length > 0, updatedAt: Date.now() };
    }));
    saveIndex();
  }

  function switchTo(id: string, msgs: ChatMessage[], list: ConvMeta[]) {
    const streamed = abortRef.current !== null;
    abortRef.current?.abort();
    setStreaming(false);
    setEditingIndex(null);
    setError("");
    atBottomRef.current = true;
    // Keep the chat being left: save its working copy if it changed since the
    // last save (a reply cut off by the switch keeps what streamed).
    const out = activeIdRef.current;
    const outMsgs = streamed ? settleStreamed(messagesRef.current) : messagesRef.current;
    if (out && list.some(cv => cv.id === out) && cacheRef.current.get(out) !== outMsgs && (outMsgs.length || cacheRef.current.has(out))) {
      writeConversation(out, outMsgs);
    }
    commitConversations(list);
    commitActiveId(id);
    commitMessages(msgs);
    saveIndex();
    setHistoryOpen(false);
  }

  async function selectChat(id: string) {
    if (id === activeIdRef.current) { setHistoryOpen(false); return; }
    const msgs = await messagesFor(id);
    if (!msgs) {
      setHistoryOpen(false);
      setError("Could not load that chat. Try again in a moment.");
      return;
    }
    switchTo(id, msgs, syncActive(conversationsRef.current));
  }

  // The + always opens a fresh room with the default Assistant; talking to a
  // character is an explicit choice made through the avatar.
  function newChat() {
    commitActiveCharacter(DEFAULT_CHARACTER_ID);
    newChatWith(DEFAULT_CHARACTER_ID);
  }

  function newChatWith(characterId: string) {
    const id = newId();
    switchTo(id, [], [metaFor(id, [], { characterId }), ...syncActive(conversationsRef.current)]);
  }

  async function deleteChat(id: string) {
    const isActive = id === activeIdRef.current;
    if (isActive) abortRef.current?.abort();
    deletedRef.current.add(id);
    cacheRef.current.delete(id);
    if (loadedRef.current) saver.removeConversation(id);
    const remaining = syncActive(conversationsRef.current).filter(cv => cv.id !== id);
    if (!isActive) {
      // Deleting a background chat: keep the open one.
      commitConversations(remaining);
      saveIndex();
      return;
    }
    // Deleted the open chat: fall back to the most recent, or a fresh empty one.
    if (remaining.length) {
      const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
      const msgs = await messagesFor(next[0].id);
      if (msgs) { switchTo(next[0].id, msgs, next); return; }
      // The fallback could not be read: open a fresh chat rather than show it empty.
      const fresh = newId();
      switchTo(fresh, [], [metaFor(fresh, []), ...next]);
      setError("Could not load the previous chat. Pick it from the list to retry.");
      return;
    }
    const fresh = newId();
    switchTo(fresh, [], [metaFor(fresh, [])]);
  }

  // ── Characters ─────────────────────────────────────────────────────────────
  // Pick a character to talk to: retag the current chat if it's empty, else start
  // a fresh one with this character.
  function activateCharacter(id: string) {
    commitActiveCharacter(id);
    setCharactersOpen(false);
    if (messagesRef.current.length === 0) {
      commitConversations(conversationsRef.current.map(cv => (cv.id === activeIdRef.current ? { ...cv, characterId: id } : cv)));
      saveIndex();
    } else {
      newChatWith(id);
    }
  }

  function createCharacter() {
    const ch: Character = { id: newId(), name: "New character", emoji: "🦊", persona: "", focus: "", memories: [] };
    saveCharacters([...charactersRef.current, ch], activeCharacterIdRef.current);
    setEditingChar(ch);
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
    saveCharacters([...charactersRef.current, ch], activeCharacterIdRef.current);
    setEditingChar(ch);
  }

  function saveCharacter(charDraft: Character) {
    const draft: Character = {
      ...charDraft,
      name: charDraft.name.trim() || "Character",
      emoji: charDraft.emoji.trim() || "💬",
      memories: charDraft.memories.map(m => m.trim()).filter(Boolean),
    };
    saveCharacters(charactersRef.current.map(ch => (ch.id === draft.id ? draft : ch)), activeCharacterIdRef.current);
    setEditingChar(null);
  }

  function deleteCharacter(id: string) {
    if (id === DEFAULT_CHARACTER_ID) return; // the Assistant is permanent
    const nextActive = activeCharacterIdRef.current === id ? DEFAULT_CHARACTER_ID : activeCharacterIdRef.current;
    // Reassign any chats that used it back to the default Assistant.
    commitConversations(conversationsRef.current.map(cv => (cv.characterId === id ? { ...cv, characterId: DEFAULT_CHARACTER_ID } : cv)));
    saveCharacters(charactersRef.current.filter(ch => ch.id !== id), nextActive);
    setEditingChar(null);
  }

  // After a reply, quietly revise this character's memory from the exchange:
  // add facts the user stated, update memories they corrected, remove ones they
  // retracted. Runs only for characters with a focus. Fire-and-forget; a second,
  // non-streaming model call that never blocks the reply.
  async function extractMemories(character: Character, userMsg: string, reply: string, convId: string, replyAt: number) {
    if (!character.focus.trim() || !configured || !userMsg.trim() || !reply.trim()) return;
    try {
      const current = charactersRef.current.find(ch => ch.id === character.id);
      if (!current) return;
      const ops = await requestMemoryOps(config, character, current.memories, userMsg, reply);
      if (!ops) return;
      const fresh = charactersRef.current.find(ch => ch.id === character.id);
      if (!fresh) return;
      const result = applyMemoryOps(fresh.memories, ops);
      if (!result) return;
      saveCharacters(
        charactersRef.current.map(ch => (ch.id === character.id ? { ...ch, memories: result.memories } : ch)),
        activeCharacterIdRef.current,
      );
      // Surface what changed as permanent text on the reply that caused it:
      // the exact message (by its `at` stamp) in the conversation the exchange
      // happened in, not whatever is on screen when the extraction finishes.
      const attach = (msgs: ChatMessage[]): ChatMessage[] => {
        let idx = msgs.findIndex(m => m.role === "assistant" && m.at === replyAt);
        if (idx === -1) idx = msgs.map(m => m.role).lastIndexOf("assistant");
        if (idx === -1) return msgs;
        return msgs.map((m, i) => (i === idx ? { ...m, memory: [...(m.memory ?? []), ...result.changes] } : m));
      };
      // Save onto the stored copy (the live one may be mid-stream again), and
      // show it on the live copy when that chat is on screen.
      const saved = cacheRef.current.get(convId);
      if (saved) writeConversation(convId, attach(saved));
      if (convId === activeIdRef.current) commitMessages(attach(messagesRef.current));
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
    // The conversation this stream belongs to: abort/error cleanup and the
    // final save must never touch a conversation the user switched to.
    const convAtStart = activeIdRef.current;
    const timing = { start: performance.now(), first: null as number | null };
    atBottomRef.current = true; // follow the new turn
    setStreamStart(timing.start);
    setStreaming(true);

    // Only the roster travels with the request; widget content is fetched
    // server-side when the model explicitly reads a widget. Widgets on the
    // dashboard are readable unless toggled off; an @-mention in the message
    // force-includes one even when its toggle is off.
    const lastUserText = [...history].reverse().find(m => m.role === "user")?.content ?? "";
    const rosterNow = !cont ? await listDashboardWidgets().catch(() => [] as WidgetRosterItem[]) : [];
    const dash = rosterNow.filter(w =>
      sourceOn(w.id) || lastUserText.includes(`@${w.title}`)
    );

    // Continuation streams into the existing message; otherwise append a placeholder.
    const before = cont ? history.slice(0, -1) : history;
    const target: ChatMessage = cont ? history[history.length - 1] : { role: "assistant", content: "" };
    commitMessages([...before, target]);

    const systemContent = buildSystemContent({ config, character: activeCharacter, dash, calendarOn, timezone: tzRef.current });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const reply = await streamChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages: upstreamMessages(history, systemContent, !!cont),
        maxTokens: config.maxTokens,
        reasoningEffort: config.effort === "default" ? "" : config.effort,
        stream: true,
        kiwix: !cont && config.useKiwix && config.kiwixUrl
          ? { baseUrl: config.kiwixUrl } // no source: search every book on the server
          : null,
        anytype: !cont && config.useAnytype && config.anytypeUrl && config.anytypeApiKey && config.anytypeSpaceId
          ? {
              baseUrl: config.anytypeUrl, apiKey: config.anytypeApiKey,
              spaceId: config.anytypeSpaceId, spaceName: config.anytypeSpaceName,
              bridgeUrl: config.anytypeBridgeUrl, bridgeToken: config.anytypeBridgeToken,
              writeMode: config.anytypeWriteMode,
            }
          : null,
        dashboard: dash.length
          ? { widgets: dash.map(w => ({ id: w.id, title: w.title, type: w.type })) }
          : null,
        caldav: !cont && calendarOn ? { ...calSource!.account, writeMode: config.calendarWriteMode } : null,
        // The user's local date and zone, so server-side calendar results
        // anchor to the same "today" the prompt states (not server UTC) and
        // event times land in the user's wall clock.
        today: todayIn(effectiveTimezone(tzRef.current)),
        timezone: effectiveTimezone(tzRef.current),
        // LM Studio sets its idle-unload from the request itself; pass the
        // chosen linger as ttl seconds (Ollama uses its own keep_alive path).
        ttl: backend === "lmstudio" ? ttlSeconds(config.keepAlive) : 0,
      }, controller.signal, body => {
        if (body && timing.first == null) timing.first = performance.now();
        if (activeIdRef.current !== convAtStart) return;
        commitMessages([...before, { ...target, content: (cont?.base ?? "") + body }]);
      });

      const { body, sources, proposals, actions } = reply;
      const stats = replyStats(reply.tokens, timing.start, timing.first, performance.now());
      const replyAt = Date.now();
      const last = history[history.length - 1];
      const finalMessages: ChatMessage[] = cont
        ? [...history.slice(0, -1), {
            ...last,
            content: cont.base + body,
            stats: stats && last.stats
              ? { ...stats, tokens: stats.tokens + (last.stats.tokens ?? 0) }
              : stats ?? last.stats,
          }]
        : [...history, { role: "assistant", content: body, at: replyAt, stats, sources, ...(proposals ? { proposals } : {}), ...(actions ? { actions } : {}) }];
      if (activeIdRef.current === convAtStart) commitMessages(finalMessages);
      saveConversation(convAtStart, finalMessages);
      // Ollama resets to its default keep_alive after a reply: restore the chosen
      // linger so it sticks. (LM Studio's ttl already rode the request above.)
      if (config.keepAlive && backend === "ollama") { postPower({ keepAlive: config.keepAlive }); pollPower(); }
      // Let the active character quietly remember anything relevant, pinned to
      // THIS conversation and THIS reply, so a chat switched to while the
      // extraction runs never receives another chat's memory notes.
      const convChar = conversationsRef.current.find(cv => cv.id === convAtStart)?.characterId ?? activeCharacterIdRef.current;
      const memCh = charactersRef.current.find(ch => ch.id === convChar);
      if (memCh) extractMemories(memCh, lastUserText, body.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(), convAtStart, replyAt);
    } catch (err) {
      // The abort may come from switching/clearing chats: `messages` then
      // belongs to ANOTHER conversation (possibly empty), and this cleanup
      // must not touch it; slicing would eat that chat's last message.
      const sameConversation = activeIdRef.current === convAtStart;
      if ((err as Error).name === "AbortError") {
        // Keep whatever streamed so far; drop a trailing empty assistant turn.
        if (sameConversation && messagesRef.current.length) {
          const next = settleStreamed(messagesRef.current);
          commitMessages(next);
          saveConversation(convAtStart, next);
        }
      } else {
        const raw = String(err instanceof Error ? err.message : err);
        setError(/image|vision|multimodal|pixel/i.test(raw)
          ? `${config.model} couldn't process the image; it may not support vision. Try another model or remove the image.`
          : raw);
        if (sameConversation) {
          const prev = messagesRef.current;
          if (prev[prev.length - 1]?.content === "") commitMessages(prev.slice(0, -1));
        }
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

  // Active conversation's display title: its manual name, or one auto-derived
  // from the first message.
  const activeConv = conversations.find(cv => cv.id === activeId);
  const chatTitle = activeConv?.renamed ? activeConv.title : titleFrom(messages);

  // Message rows are memoized, so they get stable handlers and only the
  // streaming row receives the live status.
  const daySeps = useMemo(() => daySeparators(messages), [messages]);
  const waitingLabel = powerCapable ? (isLoaded ? "processing" : "loading model") : "waiting for model";
  const live = useMemo<LiveInfo>(
    () => ({ waitingLabel, start: streamStart, active: widgetActive }),
    [waitingLabel, streamStart, widgetActive]
  );
  const onEditRow = useStableCallback(startEdit);
  const onRetryRow = useStableCallback(retry);
  const onContinueRow = useStableCallback((i: number) => {
    const msgs = messagesRef.current;
    generate([...msgs], { continueFrom: { base: msgs[i].content } });
  });
  const onResolveRow = useStableCallback(resolveProposal);
  const onOpenMemory = useStableCallback(() => {
    const ch = characters.find(x => x.id === (activeConv?.characterId ?? activeCharacterId));
    if (ch) setEditingChar(ch);
  });

  // Hover-revealed header action icon (matches the other widgets).
  const actionCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`;

  return (
    <div className={`rounded-2xl border flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>

      {/* Header: single row, no divider (a border here reads like a tab bar) */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
        <div className={`flex items-center gap-2 min-w-0 ${c.label}`}>
          {/* Identity: avatar + character name open the characters list */}
          <button
            onClick={() => { if (activeCharacter) setEditingChar(activeCharacter); }}
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
                  className="flex items-center gap-1 min-w-0 -my-0.5 py-0.5 text-[12px] opacity-60 hover:opacity-100 transition-opacity"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLoaded ? "bg-emerald-500" : "bg-current opacity-40"}`} />
                  <span className="shrink-0">
                    <ResidencyLabel backend={backend} isLoaded={isLoaded} expiresAt={residency.expiresAt} keepAlive={config.keepAlive} active={widgetActive} />
                  </span>
                  {config.model && <span className="truncate opacity-70">&nbsp;· {config.model}</span>}
                </button>
              ) : (
                <span className="text-[12px] opacity-60 truncate">{config.model}</span>
              )}
              {powerOpen && powerCapable && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setPowerOpen(false)} />
                  <div className={`absolute left-0 top-5 z-50 w-44 rounded-xl border ${c.border} ${c.bg} shadow-lg p-2.5 flex flex-col gap-2`}>
                    <p className={`text-[12px] opacity-50 ${c.label} flex items-center gap-1`}>
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
                          className={`px-2 py-1 rounded-lg text-[12px] border transition-colors disabled:opacity-40 ${
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
                      className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[12px] border border-[var(--surface-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--surface-border-focus)] disabled:opacity-30"
                    >
                      {powerBusy ? <Loader size={11} className="animate-spin" /> : <Power size={11} />}
                      Unload now
                    </button>
                    <p className={`text-[11px] opacity-60 ${c.label} leading-snug`}>
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
                    <p className={`px-2.5 pt-1.5 pb-1 text-[12px] font-ui opacity-60 ${c.label}`}>Data access</p>
                    {/* One row per data-bearing widget on the dashboard; no master
                        switch. A calendar widget's row also grants its tools. */}
                    {roster.length === 0 && (
                      <p className={`px-2.5 py-1.5 text-[12px] opacity-60 ${c.text}`}>No data widgets on this dashboard.</p>
                    )}
                    {roster.map(w => {
                      const isCal = w.type === "calendar";
                      const ready = !isCal || calSource?.widgetId === w.id;
                      const on = sourceOn(w.id);
                      return (
                        <button
                          key={w.id}
                          onClick={() => { if (ready) toggleWidgetAccess(w.id); }}
                          title={!ready ? "Configure the Calendar widget first" : on ? "On: click to turn off" : "Off: click to turn on"}
                          className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg text-xs hover:bg-black/5 dark:hover:bg-white/5 ${c.text} ${ready ? "" : "opacity-60"}`}
                        >
                          {isCal ? <CalendarDays size={13} className={`shrink-0 opacity-60 ${c.label}`} /> : <Database size={13} className={`shrink-0 opacity-60 ${c.label}`} />}
                          <span className="flex-1 min-w-0 truncate">
                            {w.title}
                            <span className={`ml-1.5 text-[12px] opacity-50 ${c.label}`}>{isCal ? "agenda + add events" : w.type}</span>
                          </span>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on && ready ? "bg-emerald-500" : "bg-current opacity-20"}`} />
                        </button>
                      );
                    })}
                    <p className={`px-2.5 pt-2 pb-1 text-[12px] font-ui opacity-60 border-t ${c.border} mt-1 ${c.label}`}>Connections</p>
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
                        className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg text-xs hover:bg-black/5 dark:hover:bg-white/5 ${c.text} ${row.ready ? "" : "opacity-60"}`}
                      >
                        <row.icon size={13} className={`shrink-0 opacity-60 ${c.label}`} />
                        <span className="flex-1 min-w-0 truncate">
                          {row.label}
                          {row.caption && <span className={`ml-1.5 text-[12px] opacity-50 ${c.label}`}>{row.caption}</span>}
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

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {/* Chats list: switches the whole widget to a list of saved conversations */}
      {historyOpen && (
        <HistoryPanel
          c={c}
          conversations={conversations}
          activeId={activeId}
          active={{ title: chatTitle, count: messages.length, autoTitle: titleFrom(messages) }}
          onNew={newChat}
          onClose={() => setHistoryOpen(false)}
          onSelect={selectChat}
          onRename={renameChat}
          onDelete={deleteChat}
        />
      )}

      {/* Characters list: pick/manage personas */}
      {charactersOpen && (
        <CharactersPanel
          c={c}
          characters={characters}
          activeCharId={activeConvCharId}
          onCreate={createCharacter}
          onClose={() => setCharactersOpen(false)}
          onActivate={activateCharacter}
          onEdit={setEditingChar}
          onDuplicate={duplicateCharacter}
          onDelete={deleteCharacter}
        />
      )}

      {/* Character editor */}
      {editingChar && (
        <CharacterEditor
          key={editingChar.id}
          c={c}
          character={editingChar}
          onCancel={() => setEditingChar(null)}
          onSave={saveCharacter}
        />
      )}

      {settingsOpen ? (
        <SettingsPanel c={c} config={config} onCancel={() => setSettingsOpen(false)} onSave={saveSettings} />
      ) : (
        /* Chat view */
        <>
          <div ref={scrollRef} onScroll={onMessagesScroll} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {loadState === "failed" ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-4">
                <p className={`text-xs opacity-60 ${c.text}`}>Could not load saved chats.</p>
                <button
                  onClick={() => setLoadAttempt(n => n + 1)}
                  className={`text-xs px-3 py-1 rounded-lg border border-[var(--surface-border)] hover:border-[var(--surface-border-focus)] ${c.text}`}
                >
                  Retry
                </button>
              </div>
            ) : !configured && messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-4">
                <Bot size={20} className={`opacity-40 ${c.text}`} />
                <p className={`text-xs opacity-60 ${c.text}`}>
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
                    className={`px-2 py-0.5 rounded-full text-[12px] text-center font-ui bg-transparent border border-[var(--surface-border)] outline-none w-44 ${c.label}`}
                  />
                ) : (
                  <button
                    onClick={() => { setTitleDraft(activeConv?.renamed ? activeConv.title : ""); setEditingTitle(true); }}
                    title="Rename this chat"
                    className={`px-2 py-0.5 rounded-full text-[12px] font-ui opacity-60 hover:opacity-70 transition-opacity ${c.label}`}
                  >
                    {chatTitle}
                  </button>
                )}
              </div>
              {messages.map((m, i) => {
                if (editingIndex === i) {
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
                const isLast = i === messages.length - 1;
                return (
                  <MessageRow
                    key={i}
                    m={m}
                    index={i}
                    c={c}
                    daySep={daySeps[i]}
                    canEdit={!streaming && !!m.content}
                    isLast={isLast}
                    live={streaming && isLast && m.role === "assistant" ? live : undefined}
                    onEdit={onEditRow}
                    onRetry={onRetryRow}
                    onContinue={onContinueRow}
                    onResolve={onResolveRow}
                    onOpenImage={setLightbox}
                    onOpenMemory={onOpenMemory}
                  />
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
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[12px] leading-none shadow-sm"
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
                    <span className="text-[12px] opacity-50">{w.type}</span>
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
                  // IME composition: Enter commits the kana/candidate, it must
                  // never send the message mid-composition.
                  if (e.nativeEvent.isComposing) return;
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
