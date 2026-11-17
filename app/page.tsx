"use client";

import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import { SHELL_EDIT_EVENT } from "@/lib/shell";
import { useShell } from "@/lib/useShell";
import { usePhone } from "@/components/MobileNav";
import WidgetGrid from "@/components/WidgetGrid";
import KeyboardLayer from "@/components/KeyboardLayer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { isEditableTarget } from "@/lib/keyboard";
import { widgets } from "@/lib/widgets";
import { getDashboards, saveDashboards, PRELOAD_KEY, PRELOAD_EVENT, type DashboardsState } from "@/lib/dashboards";
import { maybeSeedFirstRun } from "@/lib/seed";
import * as storage from "@/lib/storage";

const localDay = () => new Date().toDateString();

export default function Home() {
  const [editing, setEditing] = useState(false);
  const [dashboards, setDashboards] = useState<DashboardsState | null>(null);
  // Dashboards stay mounted once visited (hidden when inactive) so switching
  // between them keeps widget state instead of reloading everything. Widgets
  // can read useWidgetActive() (lib/activeDashboard) to idle while hidden.
  const [visited, setVisited] = useState<string[]>([]);
  const editControls = useRef<Record<string, { cancel: () => void; isDirty: () => boolean }>>({});
  // Leaving layout editing without saving: asks first when anything changed.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardEdit = () => {
    if (dashboards) editControls.current[dashboards.activeId]?.cancel();
    setConfirmDiscard(false);
    setEditing(false);
  };
  const requestCancelEdit = () => {
    const dirty = dashboards ? editControls.current[dashboards.activeId]?.isDirty() : false;
    if (dirty) setConfirmDiscard(true);
    else discardEdit();
  };
  const requestCancelRef = useRef(requestCancelEdit);
  useEffect(() => { requestCancelRef.current = requestCancelEdit; });
  // Escape while editing the layout does what the cross does. Captured ahead
  // of the keyboard layer (whose Escape also leaves demo mode), but not from
  // a text field, a menu or a dialog, which keep their own Escape.
  useEffect(() => {
    if (!editing || confirmDiscard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (isEditableTarget(t) || t?.closest('[role="dialog"], [role="menu"], [aria-modal="true"], dialog')) return;
      e.preventDefault();
      requestCancelRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing, confirmDiscard]);
  // Settings > Performance: mount every dashboard at load, not just on first visit.
  const [preload, setPreload] = useState(false);

  useEffect(() => {
    storage.getItem(PRELOAD_KEY).then(v => setPreload(v === "1"));
    const onChange = (e: Event) => setPreload(!!(e as CustomEvent).detail);
    window.addEventListener(PRELOAD_EVENT, onChange);
    return () => window.removeEventListener(PRELOAD_EVENT, onChange);
  }, []);

  // Widgets fetch their day's data once, so a tab left open overnight shows
  // yesterday everywhere. Coming back to the tab on a new day reloads it.
  useEffect(() => {
    const loadedOn = localDay();
    const onVisible = () => {
      if (document.visibilityState === "visible" && localDay() !== loadedOn) location.reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    // A true first run gets the seeded demo dashboards; everyone else loads
    // whatever they already have.
    maybeSeedFirstRun()
      .then(seeded => (seeded ? setDashboards(seeded) : getDashboards().then(setDashboards)))
      .catch(() => getDashboards().then(setDashboards));
  }, []);

  useEffect(() => {
    if (!dashboards) return;
    const ids = new Set(dashboards.list.map(d => d.id));
    setVisited(prev => {
      const kept = prev.filter(id => ids.has(id));
      return kept.includes(dashboards.activeId) ? kept : [...kept, dashboards.activeId];
    });
    if (!preload) return;
    // The active dashboard renders first; the rest mount a moment later so
    // their fetches do not compete with what is on screen.
    const t = setTimeout(() => {
      setVisited(prev => [...prev, ...dashboards.list.map(d => d.id).filter(id => !prev.includes(id))]);
    }, 1500);
    return () => clearTimeout(t);
  }, [dashboards, preload]);

  function handleDashboardsChange(next: DashboardsState) {
    setDashboards(next);
    saveDashboards(next);
  }

  // ── Phone: swipe sideways to change dashboard (docs/mobile.md) ─────────────
  // The dashboard follows the finger and its neighbour comes in beside it;
  // past a quarter of the width, or with a quick flick, letting go completes
  // the change. The panes are moved directly, not through state: a render per
  // touch move would redraw every widget.
  const phone = usePhone();
  // Inside the phone app (lib/shell.ts) each tab is a page of its own. The
  // Settings tab asks for "/?view=settings": the settings alone, no widgets.
  useShell();
  const [settingsOnly, setSettingsOnly] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "settings") setSettingsOnly(true);
    // "Edit the layout" was tapped in the Settings tab; the app passes it on.
    const onEdit = () => setEditing(true);
    window.addEventListener(SHELL_EDIT_EVENT, onEdit);
    return () => window.removeEventListener(SHELL_EDIT_EVENT, onEdit);
  }, []);
  const panes = useRef(new Map<string, HTMLDivElement>());
  const sw = useRef<{ x: number; y: number; t: number; lock: "h" | "v" | null; dx: number; to: string | null } | null>(null);
  const SWIPE_BLOCK = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], canvas, video, [draggable="true"], [data-no-swipe], [role="dialog"], .touch-none';
  function neighbour(dir: -1 | 1): string | null {
    if (!dashboards) return null;
    const i = dashboards.list.findIndex(d => d.id === dashboards.activeId);
    return dashboards.list[i + dir]?.id ?? null;
  }
  function place(id: string | null, x: number, animate: boolean) {
    const el = id ? panes.current.get(id) : null;
    if (!el) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.25, 0.6, 0.3, 1)" : "none";
    el.style.transform = `translateX(${x}px)`;
  }
  function release(id: string | null) {
    const el = id ? panes.current.get(id) : null;
    if (!el) return;
    for (const k of ["transition", "transform", "display", "position", "top", "left", "width", "flexDirection", "gap"] as const) el.style[k] = "";
  }
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => {
      sw.current = null;
      if (!dashboards || dashboards.list.length < 2 || e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest(SWIPE_BLOCK)) return;
      // A tab group swipes between its own tabs.
      const group = target.closest("[data-cell-id]");
      if (group && group.querySelectorAll("[data-tab-panel]").length > 1) return;
      // Something that scrolls sideways keeps its own scroll.
      for (let n: HTMLElement | null = target; n && n !== e.currentTarget; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return;
      }
      sw.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now(), lock: null, dx: 0, to: null };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = sw.current;
      if (!s || !dashboards) return;
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
      if (!s.lock) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { sw.current = null; return; }
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        s.lock = "h";
        // The neighbours may not have been opened yet: mount them now.
        const near = [neighbour(-1), neighbour(1)].filter((id): id is string => !!id);
        setVisited(prev => [...prev, ...near.filter(id => !prev.includes(id))]);
      }
      const to = neighbour(dx < 0 ? 1 : -1);
      if (s.to && s.to !== to) release(s.to);
      s.to = to;
      // At either end there is nothing to bring in: the dashboard resists.
      s.dx = to ? dx : dx * 0.25;
      place(dashboards.activeId, s.dx, false);
      const cur = panes.current.get(dashboards.activeId), next = to ? panes.current.get(to) : null;
      if (cur && next) {
        const r = cur.getBoundingClientRect();
        Object.assign(next.style, { display: "flex", flexDirection: "column", gap: "16px", position: "fixed", top: `${Math.max(r.top - s.dx * 0, 0)}px`, left: `${r.left - s.dx}px`, width: `${r.width}px` });
        place(to, s.dx + (dx < 0 ? 1 : -1) * (r.width + 16), false);
      }
    },
    onTouchEnd: () => {
      const s = sw.current;
      sw.current = null;
      if (!s || s.lock !== "h" || !dashboards) return;
      const from = dashboards.activeId, to = s.to;
      const width = panes.current.get(from)?.getBoundingClientRect().width ?? window.innerWidth;
      const quick = performance.now() - s.t < 260 && Math.abs(s.dx) > 40;
      const go = !!to && (Math.abs(s.dx) > width * 0.25 || quick);
      const dir = s.dx < 0 ? -1 : 1;
      place(from, go ? dir * (width + 16) : 0, true);
      if (to) place(to, go ? 0 : -dir * (width + 16), true);
      setTimeout(() => {
        release(from);
        release(to);
        if (go && to) {
          window.scrollTo({ top: 0, behavior: "instant" });
          handleDashboardsChange({ ...dashboards, activeId: to });
        }
      }, 230);
    },
    onTouchCancel: () => {
      const s = sw.current;
      sw.current = null;
      if (!s || !dashboards) return;
      release(dashboards.activeId);
      release(s.to);
    },
  };

  return (
    <div className="min-h-screen has-[[data-active=true][data-fill-viewport=true]]:h-screen has-[[data-active=true][data-fill-viewport=true]]:overflow-hidden bg-[var(--page-bg)] flex flex-col px-4 pt-2 pb-4 md:px-6 md:pt-3 md:pb-6 gap-4 md:gap-5 max-[599px]:pb-[calc(var(--ob-bar)+16px+env(safe-area-inset-bottom,0px))]">
      <TopBar
        editing={editing}
        onToggleEdit={() => setEditing(e => !e)}
        onCancelEdit={requestCancelEdit}
        dashboards={dashboards}
        onDashboardsChange={handleDashboardsChange}
        settingsOnly={settingsOnly}
      />
      {confirmDiscard && (
        <ConfirmDialog
          title="Changes not saved"
          detail="Your changes to this dashboard's layout will be lost."
          cancelLabel="Go back"
          confirmLabel="Discard changes"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={discardEdit}
        />
      )}
      {!settingsOnly && <KeyboardLayer
        dashboards={dashboards}
        onDashboardsChange={handleDashboardsChange}
        onToggleEdit={() => setEditing(e => !e)}
      />}
      {dashboards && !settingsOnly && visited.map(id => {
        const active = id === dashboards.activeId;
        return (
          <div
            key={id}
            ref={el => { if (el) panes.current.set(id, el); else panes.current.delete(id); }}
            className={active ? "flex flex-col gap-4 md:gap-5 flex-1 min-h-0 max-[599px]:[touch-action:pan-y]" : "hidden"}
            {...(active && phone && !editing ? swipe : null)}
          >
            <WidgetGrid
              dashboardId={id}
              dashboards={dashboards.list}
              active={active}
              widgets={widgets}
              editing={editing && active}
              onRegisterEditControls={c => { editControls.current[id] = c; }}
            />
          </div>
        );
      })}
    </div>
  );
}
