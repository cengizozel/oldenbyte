"use client";

import { useState, useEffect } from "react";
import { colorMap, type Widget } from "@/lib/widgets";

const STORAGE_KEY = "notebook-content";

export default function NotebookWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const [content, setContent] = useState("");
  const c = colorMap[widget.color];

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setContent(saved);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    localStorage.setItem(STORAGE_KEY, e.target.value);
  }

  return (
    <div
      className={`rounded-2xl border p-5 flex flex-col h-full ${c.bg} ${c.border} ${className}`}
    >
      <p className={`text-xs font-semibold tracking-widest uppercase mb-3 ${c.label}`}>
        {widget.title}
      </p>
      <textarea
        value={content}
        onChange={handleChange}
        placeholder="write anything..."
        className={`flex-1 resize-none outline-none text-sm bg-transparent leading-relaxed ${c.text} placeholder:opacity-30`}
      />
    </div>
  );
}
