"use client";

import Link from "next/link";
import { LayoutGrid, Newspaper, Settings } from "lucide-react";
import { FOCUS_RING } from "@/components/ui/Field";

// The bar at the bottom of a phone-width screen (docs/mobile.md): the three
// places the desktop reaches through small icons in the top bar, where a
// thumb rests. The same icons as there. A place is a button when the page
// gives a handler for it, and a link otherwise (the digest is a page of its
// own, so from there Dashboard and Settings are links back).
export const PHONE_TAB_BAR = 60; // its height, without the phone's own bottom inset

export default function PhoneTabBar({ active, onDashboard, onSettings }: {
  active: "dashboard" | "digest" | "settings";
  onDashboard?: () => void;
  onSettings?: () => void;
}) {
  const item = (on: boolean) =>
    `flex-1 h-full flex flex-col items-center justify-center gap-0.5 text-sm ${FOCUS_RING} ${on ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-muted)]"}`;
  return (
    <nav
      aria-label="Main"
      className="fixed left-0 right-0 bottom-0 z-[60] flex items-stretch border-t border-[var(--surface-border)] bg-[var(--surface)]"
      style={{ height: `calc(${PHONE_TAB_BAR}px + env(safe-area-inset-bottom, 0px))`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {onDashboard ? (
        <button type="button" onClick={onDashboard} aria-current={active === "dashboard" ? "page" : undefined} className={item(active === "dashboard")}>
          <LayoutGrid size={22} />Dashboard
        </button>
      ) : (
        <Link href="/" className={item(active === "dashboard")}><LayoutGrid size={22} />Dashboard</Link>
      )}
      {/* A full navigation: in demo mode it lands on the digest out of demo. */}
      <a href="/digest" aria-current={active === "digest" ? "page" : undefined} className={item(active === "digest")}><Newspaper size={22} />Digest</a>
      {onSettings ? (
        <button type="button" onClick={onSettings} aria-current={active === "settings" ? "page" : undefined} className={item(active === "settings")}>
          <Settings size={22} />Settings
        </button>
      ) : (
        <Link href="/#settings" className={item(active === "settings")}><Settings size={22} />Settings</Link>
      )}
    </nav>
  );
}
