export type WidgetType = "notebook" | "ebook" | "empty" | "text" | "rss";

export type WidgetColor = "amber" | "sky" | "neutral" | "rose" | "teal";

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
}> = {
  amber:   { bg: "bg-amber-50",   border: "border-amber-100",   label: "text-amber-800",   text: "text-amber-900"   },
  sky:     { bg: "bg-sky-50",     border: "border-sky-100",     label: "text-sky-700",     text: "text-sky-900"     },
neutral: { bg: "bg-neutral-50", border: "border-neutral-200", label: "text-neutral-600", text: "text-neutral-700" },
  rose:    { bg: "bg-rose-50",    border: "border-rose-100",    label: "text-rose-700",    text: "text-rose-900"    },
  teal:    { bg: "bg-teal-50",    border: "border-teal-100",    label: "text-teal-800",    text: "text-teal-900"    },
};

export const widgets: Widget[] = [
  {
    id: "notebook",
    type: "notebook",
    color: "amber",
    title: "Notebook",
    description: "A simple place for temporary notes.",
  },
  {
    id: "ebook",
    type: "ebook",
    color: "sky",
    title: "Ebook",
    description: "A saved reading spot.",
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
];
