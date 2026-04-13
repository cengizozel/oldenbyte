"use client";

import { useState, useEffect } from "react";
import type { Widget } from "@/lib/widgets";

const STORAGE_KEY = "notebook-content";

export default function NotebookWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const [content, setContent] = useState("");

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
      className={`rounded-2xl border border-neutral-200 bg-white p-5 flex flex-col h-full ${className}`}
    >
      <p className="text-xs font-medium tracking-widest text-neutral-400 uppercase mb-3">
        {widget.title}
      </p>
      <textarea
        value={content}
        onChange={handleChange}
        placeholder="write anything..."
        className="flex-1 resize-none outline-none text-sm text-neutral-600 placeholder:text-neutral-300 bg-transparent leading-relaxed"
      />
    </div>
  );
}
