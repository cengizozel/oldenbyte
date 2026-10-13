import { stripThinking } from "@/lib/citations";
import type { Character, ChatConfig } from "./types";

// Character memory upkeep. After a reply, a second non-streaming model call
// decides how the character's memory should change; applyMemoryOps turns that
// answer into the new memory list plus a human-readable change log.

export type MemoryOps = { add?: unknown; update?: unknown; remove?: unknown };

// Ask the model for memory changes. `memories` numbers the list the model
// refers to. Returns null when the call fails or the answer has no JSON.
export async function requestMemoryOps(config: ChatConfig, character: Character, memories: string[], userMsg: string, reply: string): Promise<MemoryOps | null> {
  const memList = memories.length
    ? memories.map((m, i) => `${i + 1}. ${m}`).join("\n")
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
  if (!res.ok) return null;
  const raw = stripThinking(String((await res.json()).content ?? ""));
  // Accept the op object, or a bare array (treated as adds) from models
  // that fall back to the old shape.
  const oA = raw.indexOf("{"), oB = raw.lastIndexOf("}");
  const aA = raw.indexOf("["), aB = raw.lastIndexOf("]");
  try {
    if (oA !== -1 && oB > oA) return JSON.parse(raw.slice(oA, oB + 1));
    if (aA !== -1 && aB > aA) return { add: JSON.parse(raw.slice(aA, aB + 1)) };
  } catch {}
  return null;
}

// Apply the ops to the current memory list. Returns the new list (capped at
// 40) and the change lines, or null when nothing changed.
export function applyMemoryOps(baseMems: string[], ops: MemoryOps): { memories: string[]; changes: string[] } | null {
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
  const nextMems: string[] = [];
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
  if (!changes.length) return null;
  return { memories: nextMems.slice(-40), changes }; // cap memory size
}
