// Unified tag/badge palette. Replaces the per-widget copies (Reddit SUB_COLORS,
// YouTube CH_COLORS, Tracker PALETTE) with one 12-entry palette that carries
// both a raw hex (for SVG/inline styles) and Tailwind badge classes.

export type TagColor = {
  dot: string;   // raw hex for SVG fills, donut segments, legend dots
  label: string; // Tailwind text class for badges
  bg: string;    // Tailwind background class for badges
};

export const TAG_PALETTE: TagColor[] = [
  { dot: "#f43f5e", label: "text-rose-600",    bg: "bg-rose-100" },
  { dot: "#0ea5e9", label: "text-sky-700",     bg: "bg-sky-100" },
  { dot: "#8b5cf6", label: "text-violet-700",  bg: "bg-violet-100" },
  { dot: "#14b8a6", label: "text-teal-700",    bg: "bg-teal-100" },
  { dot: "#f59e0b", label: "text-amber-700",   bg: "bg-amber-100" },
  { dot: "#10b981", label: "text-emerald-700", bg: "bg-emerald-100" },
  { dot: "#ec4899", label: "text-pink-600",    bg: "bg-pink-100" },
  { dot: "#6366f1", label: "text-indigo-600",  bg: "bg-indigo-100" },
  { dot: "#ef4444", label: "text-red-600",     bg: "bg-red-100" },
  { dot: "#06b6d4", label: "text-cyan-700",    bg: "bg-cyan-100" },
  { dot: "#a855f7", label: "text-purple-600",  bg: "bg-purple-100" },
  { dot: "#84cc16", label: "text-lime-700",    bg: "bg-lime-100" },
];

// Deterministic color for a stable key (subreddit, channel, activity id).
// Hash-based so colors survive list reordering and deletion.
export function tagColor(key: string): TagColor {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

// Positional pick for callers that map over an ordered list.
export function tagColorAt(index: number): TagColor {
  return TAG_PALETTE[index % TAG_PALETTE.length];
}
