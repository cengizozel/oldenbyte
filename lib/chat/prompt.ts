import { effectiveTimezone, nowLine, todayIn } from "@/lib/timezone";
import type { WidgetRosterItem } from "@/lib/dashboardContext";
import { BASE_IDENTITY, DEFAULT_CHARACTER_ID, LENGTH_PRESETS, type Character, type ChatConfig } from "./types";

// Combine the user's system prompt with tool guidance. Dashboard data itself
// never enters the prompt: the model reads it on demand through the
// read_widget/search_dashboard tools (the request carries the data).
export function buildSystemContent({ config, character, dash, calendarOn, timezone }: {
  config: ChatConfig;
  character: Character | undefined;
  dash: WidgetRosterItem[] | null;
  calendarOn: boolean;
  timezone: string; // the stored preference ("" = browser zone)
}): string {
  const tz = effectiveTimezone(timezone);
  const todayStr = todayIn(tz);
  const parts: string[] = [BASE_IDENTITY, `The current date and time is ${nowLine(tz)}. Use this for any "today", "now", or scheduling reasoning.`];
  // The active character's persona (the default Assistant's persona is the
  // config system prompt, so editing it in settings still works) + its memory.
  const ch = character;
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
    const writeLine = config.calendarWriteMode === "auto"
      ? `Writes execute IMMEDIATELY: only call them when the user explicitly asks to add, schedule, cancel, or remove something, and afterwards confirm exactly what you did.`
      : `Writes NEVER execute directly: they show the user a confirmation card and the user decides. Only propose one when the user explicitly asks to add, schedule, cancel, or remove something, and afterwards tell them it awaits their confirmation.`;
    parts.push(
      `You can read and write the user's calendar. Tools: list_calendar_events (any question about their schedule, free time, or upcoming events; today's date is ${todayStr}), ` +
      `create_calendar_event (add an event), delete_calendar_event (remove one — ALWAYS call list_calendar_events first and use the ref it assigns, e.g. e3). ` +
      writeLine +
      ` Event times are in the user's local time. If a write fails on a read-only calendar, say so and suggest a writable one.`
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
    if (config.anytypeBridgeUrl && config.anytypeBridgeToken) {
      const writeLine = config.anytypeWriteMode === "auto"
        ? `Writes execute IMMEDIATELY: only call them when the user explicitly asks to save, note down, or add something, and afterwards confirm exactly what you created.`
        : `Writes NEVER execute directly: they show the user a confirmation card with the content, and the user decides. Afterwards tell them it awaits their confirmation.`;
      parts.push(
        `You can also WRITE to the user's Anytype: create_anytype_object makes a new note (write the body as markdown — ## headings, - bullets, - [ ] checkboxes — it becomes real blocks), and append_to_anytype_object adds to an existing one (search for it first). ` +
        `Match the user's own style: the create tool's description tells you which object types and block styles their space actually uses — follow it, keep titles short like theirs. ` +
        writeLine
      );
    }
  }
  return parts.join("\n\n");
}
