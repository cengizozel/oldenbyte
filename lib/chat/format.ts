// Display helpers for the Chat widget: times, countdowns, reasoning blocks and
// image attachments.

// Compact countdown for the model-residency pill: 45s, 4m, 1h12m.
export function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${mm}m` : `${h}h`;
}

export function timeAgo(ms: number): string {
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
export function msgTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
export function msgDayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, new Date(Date.now() - 86400000))) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}) });
}

// Day pill for each message: its day label when it starts a new day compared
// with the previous dated message, else null. One pass over the list.
export function daySeparators(messages: { at?: number }[]): (string | null)[] {
  const out: (string | null)[] = [];
  let prev: string | null = null;
  for (const m of messages) {
    if (m.at == null) { out.push(null); continue; }
    const label = msgDayLabel(m.at);
    out.push(label !== prev ? label : null);
    prev = label;
  }
  return out;
}

// Downscale an attached image so stored conversations and model payloads stay
// small (max 1568px on the long edge, JPEG on a white background).
export async function fileToDataUrl(file: File): Promise<string | null> {
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

// Reasoning models (qwen3, deepseek-r1, ...) stream their chain-of-thought
// inline as <think>...</think>. Split it out so it can be shown in a
// collapsible block rather than mixed into the answer. Handles <thinking> too,
// and an unclosed trailing <think> mid-stream.
export type ThinkSeg = { type: "text" | "think"; content: string; open?: boolean };
export function splitThinking(raw: string): ThinkSeg[] {
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
