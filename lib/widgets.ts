export type WidgetType = "notebook" | "ebook" | "empty" | "text" | "rss" | "reddit" | "youtube" | "f1";

export type WidgetColor = "amber" | "sky" | "neutral" | "rose" | "teal" | "orange";

export type Widget = {
  id: string;
  title: string;
  description: string;
  type: WidgetType;
  color: WidgetColor;
};

export const colorMap: Record<WidgetColor, {
  bg: string;
  border: string;
  label: string;
  text: string;
  fade: string;
}> = {
  amber:   { bg: "bg-[var(--w-amber-bg)]",   border: "border-[var(--w-amber-border)]",   label: "text-[var(--w-amber-label)]",   text: "text-[var(--w-amber-text)]",   fade: "from-[var(--w-amber-bg)]"   },
  sky:     { bg: "bg-[var(--w-sky-bg)]",     border: "border-[var(--w-sky-border)]",     label: "text-[var(--w-sky-label)]",     text: "text-[var(--w-sky-text)]",     fade: "from-[var(--w-sky-bg)]"     },
  neutral: { bg: "bg-[var(--w-neutral-bg)]", border: "border-[var(--w-neutral-border)]", label: "text-[var(--w-neutral-label)]", text: "text-[var(--w-neutral-text)]", fade: "from-[var(--w-neutral-bg)]" },
  rose:    { bg: "bg-[var(--w-rose-bg)]",    border: "border-[var(--w-rose-border)]",    label: "text-[var(--w-rose-label)]",    text: "text-[var(--w-rose-text)]",    fade: "from-[var(--w-rose-bg)]"    },
  teal:    { bg: "bg-[var(--w-teal-bg)]",    border: "border-[var(--w-teal-border)]",    label: "text-[var(--w-teal-label)]",    text: "text-[var(--w-teal-text)]",    fade: "from-[var(--w-teal-bg)]"    },
  orange:  { bg: "bg-[var(--w-orange-bg)]",  border: "border-[var(--w-orange-border)]",  label: "text-[var(--w-orange-label)]",  text: "text-[var(--w-orange-text)]",  fade: "from-[var(--w-orange-bg)]"  },
};

export const widgets: Widget[] = [
  {
    id: "notebook",
    type: "notebook",
    color: "amber",
    title: "Notepad",
    description: "A simple place for temporary notes.",
  },
  {
    id: "ebook",
    type: "ebook",
    color: "sky",
    title: "Reader",
    description: "Read a PDF or EPUB file.",
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
];
