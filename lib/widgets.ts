export type WidgetType = "notebook" | "ebook" | "item" | "empty";

export type WidgetColor = "amber" | "sky" | "violet" | "neutral";

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
  amber:   { bg: "bg-amber-50",   border: "border-amber-100",   label: "text-amber-600",   text: "text-amber-900"   },
  sky:     { bg: "bg-sky-50",     border: "border-sky-100",     label: "text-sky-600",     text: "text-sky-900"     },
  violet:  { bg: "bg-violet-50",  border: "border-violet-100",  label: "text-violet-600",  text: "text-violet-900"  },
  neutral: { bg: "bg-neutral-50", border: "border-neutral-200", label: "text-neutral-500", text: "text-neutral-700" },
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
    id: "one-item",
    type: "item",
    color: "violet",
    title: "One Item",
    description: "A single resurfaced thing.",
  },
  {
    id: "empty-1",
    type: "empty",
    color: "neutral",
    title: "—",
    description: "Reserved for something future.",
  },
  {
    id: "empty-2",
    type: "empty",
    color: "neutral",
    title: "—",
    description: "Reserved for something future.",
  },
];
