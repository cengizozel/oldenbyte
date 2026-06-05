export type WidgetType = "notebook" | "ebook" | "empty" | "text" | "rss" | "reddit" | "youtube" | "f1" | "arxiv" | "hf" | "tracker" | "chess" | "chat" | "kiwix" | "anytype";

export type WidgetColor = "amber" | "sky" | "neutral" | "rose" | "teal" | "orange";

export type Widget = {
  id: string;
  title: string;
  description: string;
  type: WidgetType;
  color: WidgetColor;
  digestable?: boolean;
};

export const colorMap: Record<WidgetColor, {
  bg: string;
  border: string;
  label: string;
  text: string;
  fade: string;
  glow: string;
  icon: string;
}> = {
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
    color: "amber",
    title: "Notepad",
    description: "A simple place for temporary notes.",
    digestable: false,
  },
  {
    id: "ebook",
    type: "ebook",
    color: "sky",
    title: "Reader",
    description: "Read a PDF or EPUB file.",
    digestable: false,
  },
  {
    id: "text",
    type: "text",
    color: "rose",
    title: "Text",
    description: "A word, quote, or live string.",
  },
  {
    id: "rss",
    type: "rss",
    color: "teal",
    title: "Feed",
    description: "Headlines from any RSS feed.",
  },
  {
    id: "reddit",
    type: "reddit",
    color: "orange",
    title: "Reddit",
    description: "Top posts from your chosen subreddits.",
  },
  {
    id: "youtube",
    type: "youtube",
    color: "rose",
    title: "YouTube",
    description: "Latest videos from your chosen channels.",
  },
  {
    id: "f1",
    type: "f1",
    color: "rose",
    title: "F1",
    description: "Next race and driver standings.",
  },
  {
    id: "arxiv",
    type: "arxiv",
    color: "sky",
    title: "arXiv",
    description: "Latest papers from a chosen research field.",
  },
  {
    id: "hf",
    type: "hf",
    color: "orange",
    title: "HF Daily",
    description: "Trending AI papers curated by Hugging Face.",
  },
  {
    id: "tracker",
    type: "tracker",
    color: "teal",
    title: "Tracker",
    description: "Time how long you spend on each activity.",
    digestable: false,
  },
  {
    id: "chess",
    type: "chess",
    color: "neutral",
    title: "Chess",
    description: "Play an ongoing game against Stockfish.",
    digestable: false,
  },
  {
    id: "chat",
    type: "chat",
    color: "sky",
    title: "Chat",
    description: "Chat with a local or OpenAI-compatible model.",
    digestable: false,
  },
  {
    id: "kiwix",
    type: "kiwix",
    color: "teal",
    title: "Kiwix",
    description: "Search an offline Kiwix library (Wikipedia, etc.).",
    digestable: false,
  },
  {
    id: "anytype",
    type: "anytype",
    color: "sky",
    title: "Anytype",
    description: "Browse and search your Anytype spaces.",
    digestable: false,
  },
];
