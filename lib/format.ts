// Shared formatting helpers. Single source of truth for the relative-time,
// count, date, and duration strings that several widgets previously duplicated.

export function timeAgo(iso: string | number | Date): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// 1234 -> "1.2K", 2500000 -> "2.5M". Callers append their own unit ("views").
export function formatCount(n: number): string {
  if (!n) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${n}`;
}

// "Jun 12" (year: false) or "Jun 12, 2026" (default).
export function formatDate(input: string | number | Date, opts: { year?: boolean } = {}): string {
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.year === false ? {} : { year: "numeric" }),
  });
}

// 8052 -> "2h 14m"; 312 -> "5m"; sub-minute -> "<1m" (or seconds when asked).
export function formatDuration(totalSeconds: number, opts: { seconds?: boolean } = {}): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return opts.seconds ? `${m}m ${s % 60}s` : `${m}m`;
  return opts.seconds ? `${s}s` : "<1m";
}

// 5025 -> "1:23:45"; 83 -> "1:23". For media lengths and running clocks.
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
