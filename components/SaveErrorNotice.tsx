"use client";

import { useEffect, useState } from "react";
import { Loader, X } from "lucide-react";
import { SAVE_FAILED_EVENT, SAVE_STATE_EVENT, pendingSaves } from "@/lib/storage";

// Save feedback for the whole page, mounted once in the root layout:
// - "Saving..." while writes are waiting on the server (shown only when that
//   takes more than a moment, so quick saves do not flicker), and a browser
//   "leave page?" prompt if a reload would throw an unsaved write away;
// - a notice when a write fails (lib/storage raises SAVE_FAILED_EVENT), so an
//   edit that never saved does not look saved.
export default function SaveErrorNotice() {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    let show: ReturnType<typeof setTimeout> | undefined;
    const onState = (e: Event) => {
      const n = (e as CustomEvent<{ pending: number }>).detail?.pending ?? 0;
      clearTimeout(show);
      if (n > 0) show = setTimeout(() => setSaving(true), 400);
      else setSaving(false);
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (pendingSaves() > 0) e.preventDefault();
    };
    window.addEventListener(SAVE_STATE_EVENT, onState);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener(SAVE_STATE_EVENT, onState);
      window.removeEventListener("beforeunload", onLeave);
      clearTimeout(show);
    };
  }, []);

  if (reason) {
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
  if (!saving) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full shadow-md text-xs bg-[var(--surface)] text-[var(--text-secondary)] border border-[var(--surface-border)]"
    >
      <Loader size={12} className="animate-spin" />
      Saving...
    </div>
  );
}
