import * as storage from "@/lib/storage";
import { listDashboardWidgets, type WidgetRosterItem } from "@/lib/dashboardContext";
import {
  DEFAULT_CHARACTER_ID, DEFAULT_CONFIG, defaultCharacter, newId, titleFrom,
  type Character, type ChatConfig, type ChatMessage, type Conversation, type ConvMeta,
} from "./types";

// Chat persistence. Each conversation lives under its own key, and a small
// index key carries everything else (config, characters, active ids, and the
// per-conversation metadata the history list shows). Older versions kept the
// whole state in one key that grew without bound and eventually crossed the
// server's 1 MB value limit; it is migrated on first load.
//
//   chat-widget-<widgetId>               legacy single key (read once, then removed)
//   chat-<widgetId>-index                ChatIndex
//   chat-<widgetId>-conv-<conversationId> { messages: ChatMessage[] }

export function chatKeys(widgetId: string) {
  return {
    legacy: `chat-widget-${widgetId}`,
    index: `chat-${widgetId}-index`,
    conv: (convId: string) => `chat-${widgetId}-conv-${convId}`,
  };
}

export type ChatIndex = {
  config: ChatConfig;
  activeId: string;
  characters: Character[];
  activeCharacterId: string;
  conversations: ConvMeta[];
};

// The legacy single-key value.
type LegacyChatState = {
  config?: Partial<ChatConfig>;
  conversations?: Conversation[];
  activeId?: string;
  characters?: Character[];
  activeCharacterId?: string;
  messages?: ChatMessage[]; // older still: a single conversation
};

export type LoadedChat = ChatIndex & {
  // Conversations already in memory: every one after a legacy migration,
  // otherwise just the active one (the rest load when opened).
  messages: Map<string, ChatMessage[]>;
  // Legacy data was read but copying it to the split keys did not fully
  // succeed; the legacy key is untouched and the next index save retries.
  migrationPending: boolean;
};

export function metaFor(id: string, messages: ChatMessage[], extra: Partial<ConvMeta> = {}): ConvMeta {
  const auto = titleFrom(messages);
  return { id, title: auto, autoTitle: auto, count: messages.length, updatedAt: Date.now(), ...extra };
}

// The entry refreshed after its messages changed: count, derived title, time.
export function touchMeta(cv: ConvMeta, messages: ChatMessage[]): ConvMeta {
  const auto = titleFrom(messages);
  return { ...cv, autoTitle: auto, title: cv.renamed ? cv.title : auto, count: messages.length, updatedAt: Date.now() };
}

// Bring a stored config up to the current data-access semantics.
async function upgradeConfig(saved: Partial<ChatConfig> | undefined): Promise<ChatConfig> {
  let cfg: ChatConfig = { ...DEFAULT_CONFIG, ...saved };
  if ((cfg.sourcesVersion ?? 1) < 2) {
    // v1 had a master useDashboard switch with missing-key = included;
    // v2 was explicit per-widget opt-in. Materialize the old semantics.
    const roster = await listDashboardWidgets().catch(() => [] as WidgetRosterItem[]);
    const explicit: Record<string, boolean> = {};
    for (const w of roster) {
      explicit[w.id] = w.type === "calendar"
        ? !!cfg.useCalendar
        : (cfg.useDashboard ? cfg.dashboardWidgets[w.id] !== false : false);
    }
    cfg = { ...cfg, dashboardWidgets: explicit, sourcesVersion: 2 };
  }
  if ((cfg.sourcesVersion ?? 1) < 3) {
    // v3: a widget ON the dashboard is readable unless explicitly toggled off
    // (missing entry = on). Existing explicit choices keep working; widgets
    // added later are visible by default, and widgets removed from the
    // dashboard drop out of the roster entirely.
    cfg = { ...cfg, sourcesVersion: 3 };
  }
  return cfg;
}

// Make sure the built-in Assistant exists (its persona is the config system
// prompt) and the active character points at a real one.
function settleCharacters(cfg: ChatConfig, chars: Character[] | undefined, active: string | undefined) {
  let characters = Array.isArray(chars) ? chars : [];
  if (!characters.some(ch => ch.id === DEFAULT_CHARACTER_ID)) characters = [defaultCharacter(cfg.system), ...characters];
  const activeCharacterId = active && characters.some(ch => ch.id === active) ? active : DEFAULT_CHARACTER_ID;
  return { characters, activeCharacterId };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseConversation(raw: string): ChatMessage[] | null {
  try {
    const v = JSON.parse(raw);
    return isObject(v) && Array.isArray(v.messages) ? (v.messages as ChatMessage[]) : null;
  } catch {
    return null;
  }
}

function serializeConversation(messages: ChatMessage[]): string {
  return JSON.stringify({ messages });
}

// Read one conversation's messages. A missing key is an empty conversation
// (created but never saved); a failed read or an unreadable value is reported
// so the caller never treats it as empty and saves over it.
export async function loadConversation(widgetId: string, convId: string): Promise<{ ok: true; messages: ChatMessage[] } | { ok: false }> {
  const res = await storage.getItemResult(chatKeys(widgetId).conv(convId));
  if (!res.ok) return { ok: false };
  if (res.value == null) return { ok: true, messages: [] };
  const messages = parseConversation(res.value);
  return messages ? { ok: true, messages } : { ok: false };
}

// Copy every conversation to its own key, then write the index, then drop the
// legacy key. Each step runs only when everything before it succeeded, so a
// failure at any point leaves the legacy key as the source of truth.
async function writeSplit(widgetId: string, index: ChatIndex, convs: Map<string, ChatMessage[]>): Promise<boolean> {
  const keys = chatKeys(widgetId);
  const results = await Promise.all(
    [...convs].map(([id, msgs]) => storage.setItem(keys.conv(id), serializeConversation(msgs)))
  );
  if (!results.every(Boolean)) return false;
  if (!(await storage.setItem(keys.index, JSON.stringify(index)))) return false;
  await storage.removeItem(keys.legacy); // a leftover legacy key is ignored once the index exists
  return true;
}

// A fresh, unsaved conversation as the starting point.
function freshStart(cfg: ChatConfig, chars?: Character[], activeChar?: string): LoadedChat {
  const id = newId();
  return {
    config: cfg,
    ...settleCharacters(cfg, chars, activeChar),
    activeId: id,
    conversations: [metaFor(id, [])],
    messages: new Map([[id, []]]),
    migrationPending: false,
  };
}

type LoadResult = { ok: true; chat: LoadedChat } | { ok: false };

// Load the chat state, migrating the legacy single key when the index does not
// exist yet. Returns ok: false when anything could not be read, in which case
// the caller must not save (it would overwrite data it never saw). Concurrent
// loads of one widget (a quick remount) share a single read, so two
// migrations can never interleave.
const inflight = new Map<string, Promise<LoadResult>>();
export function loadChat(widgetId: string): Promise<LoadResult> {
  let p = inflight.get(widgetId);
  if (!p) {
    p = readChat(widgetId).finally(() => inflight.delete(widgetId));
    inflight.set(widgetId, p);
  }
  return p;
}

async function readChat(widgetId: string): Promise<LoadResult> {
  const keys = chatKeys(widgetId);
  const idx = await storage.getItemResult(keys.index);
  if (!idx.ok) return { ok: false };

  if (idx.value != null) {
    let parsed: unknown;
    try { parsed = JSON.parse(idx.value); } catch { return { ok: false }; }
    if (!isObject(parsed)) return { ok: false };
    const index = parsed as Partial<ChatIndex>;
    const cfg = await upgradeConfig(index.config);
    const conversations = Array.isArray(index.conversations) ? index.conversations : [];
    if (!conversations.length) return { ok: true, chat: freshStart(cfg, index.characters, index.activeCharacterId) };
    const activeId = index.activeId && conversations.some(cv => cv.id === index.activeId) ? index.activeId : conversations[0].id;
    const conv = await loadConversation(widgetId, activeId);
    if (!conv.ok) return { ok: false };
    return {
      ok: true,
      chat: {
        config: cfg,
        ...settleCharacters(cfg, index.characters, index.activeCharacterId),
        activeId,
        conversations,
        messages: new Map([[activeId, conv.messages]]),
        migrationPending: false,
      },
    };
  }

  // No index yet: a new widget, or the first load since the split.
  const legacy = await storage.getItemResult(keys.legacy);
  if (!legacy.ok) return { ok: false };
  let parsed: LegacyChatState | null = null;
  if (legacy.value != null) {
    try {
      const v = JSON.parse(legacy.value);
      if (isObject(v)) parsed = v as LegacyChatState;
    } catch { /* unreadable: leave the legacy key untouched and start fresh */ }
  }
  if (!parsed) return { ok: true, chat: freshStart(DEFAULT_CONFIG) };

  const cfg = await upgradeConfig(parsed.config);
  let convs: Conversation[];
  let activeId: string;
  if (parsed.conversations?.length) {
    convs = parsed.conversations;
    activeId = parsed.activeId && convs.some(cv => cv.id === parsed.activeId) ? parsed.activeId : convs[0].id;
  } else {
    // Oldest format: a single { messages }, wrapped as one conversation.
    const msgs = parsed.messages ?? [];
    activeId = newId();
    convs = [{ id: activeId, title: titleFrom(msgs), messages: msgs, updatedAt: Date.now() }];
  }
  const chat: LoadedChat = {
    config: cfg,
    ...settleCharacters(cfg, parsed.characters, parsed.activeCharacterId),
    activeId,
    conversations: convs.map(cv => ({
      id: cv.id,
      title: cv.title,
      autoTitle: titleFrom(cv.messages ?? []),
      count: (cv.messages ?? []).length,
      updatedAt: cv.updatedAt,
      ...(cv.renamed ? { renamed: true } : {}),
      ...(cv.characterId ? { characterId: cv.characterId } : {}),
    })),
    messages: new Map(convs.map(cv => [cv.id, cv.messages ?? []])),
    migrationPending: false,
  };
  const index: ChatIndex = {
    config: chat.config, activeId: chat.activeId, characters: chat.characters,
    activeCharacterId: chat.activeCharacterId, conversations: chat.conversations,
  };
  chat.migrationPending = !(await writeSplit(widgetId, index, chat.messages));
  return { ok: true, chat };
}

// Runs saves for one key strictly in order, keeping at most one waiting: a
// newer save of the same key replaces an older one that has not started yet.
function createKeyQueue() {
  const running = new Set<string>();
  const waiting = new Map<string, () => Promise<unknown>>();
  function run(key: string, job: () => Promise<unknown>) {
    if (running.has(key)) { waiting.set(key, job); return; }
    running.add(key);
    job().catch(() => {}).then(() => {
      running.delete(key);
      const next = waiting.get(key);
      if (next) { waiting.delete(key); run(key, next); }
    });
  }
  return run;
}

// Saves for one widget. Values are read when a save actually runs, so queued
// saves always write the newest state.
export function createChatSaver(widgetId: string, source: {
  index: () => ChatIndex;
  conversation: (convId: string) => ChatMessage[] | undefined;
  // Every conversation; only used to retry an unfinished legacy migration,
  // when they are all in memory.
  all: () => Map<string, ChatMessage[]>;
}) {
  const keys = chatKeys(widgetId);
  const run = createKeyQueue();
  let migrationPending = false;

  return {
    setMigrationPending(v: boolean) { migrationPending = v; },

    saveIndex() {
      run(keys.index, async () => {
        if (migrationPending) {
          if (await writeSplit(widgetId, source.index(), source.all())) migrationPending = false;
          return;
        }
        await storage.setItem(keys.index, JSON.stringify(source.index()));
      });
    },

    saveConversation(convId: string) {
      run(keys.conv(convId), async () => {
        const msgs = source.conversation(convId);
        if (msgs) await storage.setItem(keys.conv(convId), serializeConversation(msgs));
      });
    },

    removeConversation(convId: string) {
      run(keys.conv(convId), () => storage.removeItem(keys.conv(convId)));
    },
  };
}

export type ChatSaver = ReturnType<typeof createChatSaver>;
