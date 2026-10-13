"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { SAVE_FAILED_EVENT } from "@/lib/storage";

// Shows a small notice when a write to the server fails (lib/storage raises
// SAVE_FAILED_EVENT), so an edit that never saved does not look saved.
// Mounted once in the root layout.
export default function SaveErrorNotice() {
  const [reason, setReason] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFail = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; reason: string }>).detail;
      setReason(detail?.reason || "unknown error");
      clearTimeout(timer);
      timer = setTimeout(() => setReason(""), 8000);
    };
    window.addEventListener(SAVE_FAILED_EVENT, onFail);
    return () => {
      window.removeEventListener(SAVE_FAILED_EVENT, onFail);
      clearTimeout(timer);
    };
  }, []);

  if (!reason) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-xl shadow-lg text-sm bg-red-600 text-white"
    >
      <span>Couldn&apos;t save your last change ({reason}).</span>
      <button onClick={() => setReason("")} aria-label="Dismiss" className="opacity-80 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}
