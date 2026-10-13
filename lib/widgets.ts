export type WidgetType = "notebook" | "ebook" | "empty" | "text" | "rss" | "reddit" | "youtube" | "f1" | "arxiv" | "hf" | "tracker" | "rhythm" | "upkeep" | "bookmarks" | "typing" | "chess" | "chat" | "kiwix" | "anytype" | "weather" | "calendar" | "schedule" | "tv" | "custom";

export type WidgetColor = "amber" | "sky" | "neutral" | "rose" | "teal" | "orange";

export type WidgetCategory = "tools" | "feeds" | "knowledge" | "ai";

// Picker display order and labels for template categories.
export const WIDGET_CATEGORIES: { id: WidgetCategory; label: string }[] = [
  { id: "feeds",     label: "Feeds" },
  { id: "tools",     label: "Tools" },
  { id: "knowledge", label: "Knowledge" },
  { id: "ai",        label: "AI" },
];

export type Widget = {
  id: string;
  title: string;
  description: string;
  type: WidgetType;
  color: WidgetColor;
  digestable?: boolean;
  category?: WidgetCategory;
  // For type "custom": which widget-bank definition renders this instance.
  bankId?: string;
  // Registry only: grid cells a new instance starts with. Stripped by
  // instanceOf() so it is never persisted on placed instances.
  defaultSize?: WidgetSize;
};

export type WidgetSize = { w: number; h: number };

export type ColorClasses = {
  bg: string;
  border: string;
  label: string;
  text: string;
  fade: string;
  glow: string;
  icon: string;
};

export const colorMap: Record<WidgetColor, ColorClasses> = {
  // `icon` is the color for small action icons (pencil, history, settings…),
  // using each palette's `text` tone, the higher-contrast-against-bg shade in
  // both modes. (Firefox doesn't repaint these icons' SVG `currentColor` on a
  // theme toggle while they sit at opacity:0; applyTheme() in TopBar nudges them
  // to re-render so the color updates live.)
  amber:   { bg: "bg-[var(--w-amber-bg)]",   border: "border-[var(--w-amber-border)]",   label: "text-[var(--w-amber-label)]",   text: "text-[var(--w-amber-text)]",   fade: "from-[var(--w-amber-bg)]",   glow: "w-amber-glow",   icon: "text-[var(--w-amber-text)]"   },
  sky:     { bg: "bg-[var(--w-sky-bg)]",     border: "border-[var(--w-sky-border)]",     label: "text-[var(--w-sky-label)]",     text: "text-[var(--w-sky-text)]",     fade: "from-[var(--w-sky-bg)]",     glow: "w-sky-glow",     icon: "text-[var(--w-sky-text)]"     },
  neutral: { bg: "bg-[var(--w-neutral-bg)]", border: "border-[var(--w-neutral-border)]", label: "text-[var(--w-neutral-label)]", text: "text-[var(--w-neutral-text)]", fade: "from-[var(--w-neutral-bg)]", glow: "w-neutral-glow", icon: "text-[var(--w-neutral-text)]" },
  rose:    { bg: "bg-[var(--w-rose-bg)]",    border: "border-[var(--w-rose-border)]",    label: "text-[var(--w-rose-label)]",    text: "text-[var(--w-rose-text)]",    fade: "from-[var(--w-rose-bg)]",    glow: "w-rose-glow",    icon: "text-[var(--w-rose-text)]"    },
  teal:    { bg: "bg-[var(--w-teal-bg)]",    border: "border-[var(--w-teal-border)]",    label: "text-[var(--w-teal-label)]",    text: "text-[var(--w-teal-text)]",    fade: "from-[var(--w-teal-bg)]",    glow: "w-teal-glow",    icon: "text-[var(--w-teal-text)]"    },
  orange:  { bg: "bg-[var(--w-orange-bg)]",  border: "border-[var(--w-orange-border)]",  label: "text-[var(--w-orange-label)]",  text: "text-[var(--w-orange-text)]",  fade: "from-[var(--w-orange-bg)]",  glow: "w-orange-glow",  icon: "text-[var(--w-orange-text)]"  },
};

export const widgets: Widget[] = [
  {
    id: "notebook",
    type: "notebook",
    defaultSize: { w: 2, h: 2 },
    category: "tools",
    color: "amber",
    title: "Notepad",
    description: "A simple place for temporary notes.",
    digestable: false,
  },
  {
    id: "ebook",
    type: "ebook",
    defaultSize: { w: 2, h: 3 },
    category: "tools",
    color: "sky",
    title: "Reader",
    description: "Read a PDF or EPUB file.",
    digestable: false,
  },
  {
    id: "text",
    type: "text",
    defaultSize: { w: 2, h: 1 },
    category: "tools",
    color: "rose",
    title: "Text",
    description: "A word, quote, or live string.",
  },
  {
    id: "rss",
    type: "rss",
    defaultSize: { w: 2, h: 3 },
    category: "feeds",
    color: "teal",
    title: "Feed",
    description: "Headlines from any RSS feed.",
  },
  {
    id: "reddit",
    type: "reddit",
    defaultSize: { w: 1, h: 3 },
    category: "feeds",
    color: "orange",
    title: "Reddit",
    description: "Top posts from your chosen subreddits.",
  },
  {
    id: "youtube",
    type: "youtube",
    defaultSize: { w: 1, h: 3 },
    category: "feeds",
    color: "rose",
    title: "YouTube",
    description: "Latest videos from your chosen channels.",
  },
  {
    id: "weather",
    type: "weather",
    defaultSize: { w: 1, h: 3 },
    category: "feeds",
    color: "sky",
    title: "Weather",
    description: "Current conditions and forecast for a place.",
  },
  {
    id: "f1",
    type: "f1",
    defaultSize: { w: 1, h: 2 },
    category: "feeds",
    color: "rose",
    title: "F1",
    description: "Next race and driver standings.",
  },
  {
    id: "arxiv",
    type: "arxiv",
    defaultSize: { w: 2, h: 3 },
    category: "feeds",
    color: "sky",
    title: "arXiv",
    description: "Latest papers from a chosen research field.",
  },
  {
    id: "hf",
    type: "hf",
    defaultSize: { w: 2, h: 3 },
    category: "feeds",
    color: "orange",
    title: "HF Daily",
    description: "Trending AI papers curated by Hugging Face.",
  },
  {
    id: "calendar",
    type: "calendar",
    defaultSize: { w: 1, h: 3 },
    category: "tools",
    color: "amber",
    title: "Calendar",
    description: "Upcoming events from a CalDAV server (Nextcloud, Radicale).",
  },
  {
    id: "tracker",
    type: "tracker",
    defaultSize: { w: 1, h: 3 },
    category: "tools",
    color: "teal",
    title: "Tracker",
    description: "Time how long you spend on each activity.",
    digestable: false,
  },
  {
    id: "schedule",
    type: "schedule",
    defaultSize: { w: 2, h: 4 },
    category: "tools",
    color: "sky",
    title: "Schedule",
    description: "Your fixed weekly routine on a seven-day time grid.",
    digestable: false,
  },
  {
    id: "rhythm",
    type: "rhythm",
    defaultSize: { w: 1, h: 3 },
    category: "tools",
    color: "rose",
    title: "Rhythm",
    description: "Tap to log habits and see how often and when you do them.",
    digestable: false,
  },
  {
    id: "upkeep",
    type: "upkeep",
    defaultSize: { w: 1, h: 3 },
    category: "tools",
    color: "orange",
    title: "Upkeep",
    description: "Check off daily essentials and keep your day's score at 100.",
    digestable: false,
  },
  {
    id: "bookmarks",
    type: "bookmarks",
    defaultSize: { w: 1, h: 3 },
    category: "tools",
    color: "sky",
    title: "Bookmarks",
    description: "Your favorite links as icon tiles, rows, or a compact list.",
    digestable: false,
  },
  {
    id: "typing",
    type: "typing",
    defaultSize: { w: 2, h: 3 },
    category: "tools",
    color: "amber",
    title: "Typing",
    description: "A typing trainer that targets your weak keys and error patterns.",
    digestable: false,
  },
  {
    id: "chess",
    type: "chess",
    defaultSize: { w: 2, h: 4 },
    category: "tools",
    color: "neutral",
    title: "Chess",
    description: "Play an ongoing game against Stockfish.",
    digestable: false,
  },
  {
    id: "chat",
    type: "chat",
    defaultSize: { w: 1, h: 4 },
    category: "ai",
    color: "sky",
    title: "Chat",
    description: "Chat with a local or OpenAI-compatible model.",
    digestable: false,
  },
  {
    id: "kiwix",
    type: "kiwix",
    defaultSize: { w: 1, h: 4 },
    category: "knowledge",
    color: "teal",
    title: "Kiwix",
    description: "Search an offline Kiwix library (Wikipedia, etc.).",
    digestable: false,
  },
  {
    id: "anytype",
    type: "anytype",
    defaultSize: { w: 1, h: 4 },
    category: "knowledge",
    color: "sky",
    title: "Anytype",
    description: "Browse and search your Anytype spaces.",
    digestable: false,
  },
  {
    id: "tv",
    type: "tv",
    defaultSize: { w: 2, h: 3 },
    category: "feeds",
    color: "rose",
    title: "TV",
    description: "Watch IPTV/HLS channels, e.g. an ErsatzTV playlist.",
    digestable: false,
  },
];

const FALLBACK_SIZE: WidgetSize = { w: 2, h: 2 };

// Default grid size for a built-in widget type, from its registry entry.
export function defaultSizeFor(type: WidgetType): WidgetSize {
  return widgets.find(w => w.type === type)?.defaultSize ?? FALLBACK_SIZE;
}

// A placed instance built from a registry template: registry-only fields are
// dropped so they do not end up in the saved dashboard.
export function instanceOf(template: Widget, id: string, title = template.title): Widget {
  const inst: Widget = { ...template, id, title };
  delete inst.defaultSize;
  return inst;
}
