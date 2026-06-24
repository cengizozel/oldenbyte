export type WidgetType = "notebook" | "ebook" | "empty" | "text" | "rss" | "reddit" | "youtube" | "f1" | "arxiv" | "hf" | "tracker" | "rhythm" | "upkeep" | "bookmarks" | "chess" | "chat" | "kiwix" | "anytype" | "weather" | "calendar" | "custom";

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
};

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
  // using each palette's `text` tone — the higher-contrast-against-bg shade in
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
    category: "tools",
    color: "amber",
    title: "Notepad",
    description: "A simple place for temporary notes.",
    digestable: false,
  },
  {
    id: "ebook",
    type: "ebook",
    category: "tools",
    color: "sky",
    title: "Reader",
    description: "Read a PDF or EPUB file.",
    digestable: false,
  },
  {
    id: "text",
    type: "text",
    category: "tools",
    color: "rose",
    title: "Text",
    description: "A word, quote, or live string.",
  },
  {
    id: "rss",
    type: "rss",
    category: "feeds",
    color: "teal",
    title: "Feed",
    description: "Headlines from any RSS feed.",
  },
  {
    id: "reddit",
    type: "reddit",
    category: "feeds",
    color: "orange",
    title: "Reddit",
    description: "Top posts from your chosen subreddits.",
  },
  {
    id: "youtube",
    type: "youtube",
    category: "feeds",
    color: "rose",
    title: "YouTube",
    description: "Latest videos from your chosen channels.",
  },
  {
    id: "weather",
    type: "weather",
    category: "feeds",
    color: "sky",
    title: "Weather",
    description: "Current conditions and forecast for a place.",
  },
  {
    id: "f1",
    type: "f1",
    category: "feeds",
    color: "rose",
    title: "F1",
    description: "Next race and driver standings.",
  },
  {
    id: "arxiv",
    type: "arxiv",
    category: "feeds",
    color: "sky",
    title: "arXiv",
    description: "Latest papers from a chosen research field.",
  },
  {
    id: "hf",
    type: "hf",
    category: "feeds",
    color: "orange",
    title: "HF Daily",
    description: "Trending AI papers curated by Hugging Face.",
  },
  {
    id: "calendar",
    type: "calendar",
    category: "tools",
    color: "amber",
    title: "Calendar",
    description: "Upcoming events from a CalDAV server (Nextcloud, Radicale).",
  },
  {
    id: "tracker",
    type: "tracker",
    category: "tools",
    color: "teal",
    title: "Tracker",
    description: "Time how long you spend on each activity.",
    digestable: false,
  },
  {
    id: "rhythm",
    type: "rhythm",
    category: "tools",
    color: "rose",
    title: "Rhythm",
    description: "Tap to log habits and see how often and when you do them.",
    digestable: false,
  },
  {
    id: "upkeep",
    type: "upkeep",
    category: "tools",
    color: "orange",
    title: "Upkeep",
    description: "Check off daily essentials and keep your day's score at 100.",
    digestable: false,
  },
  {
    id: "bookmarks",
    type: "bookmarks",
    category: "tools",
    color: "sky",
    title: "Bookmarks",
    description: "Your favorite links as icon tiles, rows, or a compact list.",
    digestable: false,
  },
  {
    id: "chess",
    type: "chess",
    category: "tools",
    color: "neutral",
    title: "Chess",
    description: "Play an ongoing game against Stockfish.",
    digestable: false,
  },
  {
    id: "chat",
    type: "chat",
    category: "ai",
    color: "sky",
    title: "Chat",
    description: "Chat with a local or OpenAI-compatible model.",
    digestable: false,
  },
  {
    id: "kiwix",
    type: "kiwix",
    category: "knowledge",
    color: "teal",
    title: "Kiwix",
    description: "Search an offline Kiwix library (Wikipedia, etc.).",
    digestable: false,
  },
  {
    id: "anytype",
    type: "anytype",
    category: "knowledge",
    color: "sky",
    title: "Anytype",
    description: "Browse and search your Anytype spaces.",
    digestable: false,
  },
];
