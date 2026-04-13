export type WidgetType = "notebook" | "ebook" | "item" | "empty";

export type Widget = {
  id: string;
  title: string;
  description: string;
  type: WidgetType;
};

export const widgets: Widget[] = [
  {
    id: "notebook",
    type: "notebook",
    title: "Notebook",
    description: "A simple place for temporary notes.",
  },
  {
    id: "ebook",
    type: "ebook",
    title: "Ebook",
    description: "A saved reading spot.",
  },
  {
    id: "one-item",
    type: "item",
    title: "One Item",
    description: "A single resurfaced thing.",
  },
  {
    id: "empty-1",
    type: "empty",
    title: "—",
    description: "Reserved for something future.",
  },
  {
    id: "empty-2",
    type: "empty",
    title: "—",
    description: "Reserved for something future.",
  },
];
