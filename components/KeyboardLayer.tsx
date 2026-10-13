"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { RotateCcw } from "lucide-react";
import type { DashboardsState } from "@/lib/dashboards";
import {
  DEFAULT_KEYBOARD, KEYBOARD_ACTIONS, KEYBOARD_EVENT, NEW_DASHBOARD_EVENT, MAX_CELLS, MAX_TABS, TAB_LETTERS,
  cellDigit, cellFromKey, tabFromKey, actionForKey, isBindableKey, isEditableTarget, keyLabel, rebind,
  loadKeyboardConfig, saveKeyboardConfig, type KeyboardAction, type KeyboardConfig,
} from "@/lib/keyboard";
import Toggle from "@/components/ui/Toggle";

// Global keyboard layer: leader key, widget number badges, focus ring, cheat
// sheet. It finds its targets through data attributes WidgetGrid puts on the
// visible grid ([data-widget-grid][data-active]), its cells ([data-cell-index],
// in reading order), tab buttons ([data-tab-index]) and each widget's node
// ([data-widget-id]), so neither side imports the other.
//
// Vimium: its content script sees keys before the page and binds most plain
// letters, but it passes everything through while an editable element is
// focused. Space is not a Vimium key, so the leader arrives here; the layer then
// focuses a hidden input (the command catcher) and reads the following keys
// from it. Finishing a command blurs it again, which hands keys back to Vimium.

const TIMEOUT = 1500;
const MODIFIERS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"];
const FOCUSABLE_FIELDS =
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=file]):not([type=color]), textarea, select, [contenteditable='true'], [contenteditable='']";

type Badge = { key: string; label: string; top: number; left: number; tab: boolean };
type Phase = { kind: "leader" } | { kind: "tab"; cell: HTMLElement } | { kind: "help" };

// Rendered and not inside an inert subtree (the hidden face of a FlipCard).
function isShown(el: Element): boolean {
  return el.getClientRects().length > 0 && !el.closest("[inert]");
}

function visibleCells(): HTMLElement[] {
  const grid = document.querySelector('[data-widget-grid][data-active="true"]');
  if (!grid) return [];
  return Array.from(grid.querySelectorAll<HTMLElement>("[data-cell-index]"))
    .filter(isShown)
    .sort((a, b) => Number(a.dataset.cellIndex) - Number(b.dataset.cellIndex))
    .slice(0, MAX_CELLS);
}

function tabButtons(cell: HTMLElement): HTMLElement[] {
  return Array.from(cell.querySelectorAll<HTMLElement>("[data-tab-index]")).slice(0, MAX_TABS);
}

// The widget currently showing in a cell (the active tab, for groups).
function widgetIn(cell: HTMLElement): HTMLElement | null {
  return Array.from(cell.querySelectorAll<HTMLElement>("[data-widget-id]")).find(isShown) ?? null;
}

// [data-autofocus] first, then the first text field, else the widget itself.
function bestTarget(widget: HTMLElement): HTMLElement {
  const marked = Array.from(widget.querySelectorAll<HTMLElement>("[data-autofocus]"));
  const fields = Array.from(widget.querySelectorAll<HTMLElement>(FOCUSABLE_FIELDS));
  return [...marked, ...fields].find(el => isShown(el) && !(el as HTMLInputElement).disabled) ?? widget;
}

function findButton(widget: HTMLElement, selector: string): HTMLElement | null {
  return Array.from(widget.querySelectorAll<HTMLElement>(selector))
    .find(el => isShown(el) && !(el as HTMLButtonElement).disabled) ?? null;
}

// Lets React commit a state change (tab switch, settings flip) before focusing.
function afterRender(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-[var(--surface-border)] text-[12px] text-[var(--text-muted)] whitespace-nowrap">
      {children}
    </kbd>
  );
}

export default function KeyboardLayer({
  dashboards,
  onDashboardsChange,
  onToggleEdit,
}: {
  dashboards: DashboardsState | null;
  onDashboardsChange: (next: DashboardsState) => void;
  onToggleEdit: () => void;
}) {
  const [config, setConfig] = useState<KeyboardConfig>(DEFAULT_KEYBOARD);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hint, setHint] = useState("");
  const catcherRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef<Phase | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Focus before the leader, restored when a command does not move it.
  const prevFocusRef = useRef<HTMLElement | null>(null);
  // The cell wearing the focus ring ([data-kb-focus], styled in globals.css).
  const ringRef = useRef<HTMLElement | null>(null);
  // Latest props for the listeners registered once below.
  const latest = useRef({ config, dashboards, onDashboardsChange, onToggleEdit });
  useEffect(() => { latest.current = { config, dashboards, onDashboardsChange, onToggleEdit }; });

  useEffect(() => {
    loadKeyboardConfig().then(setConfig);
    const onChange = (e: Event) => setConfig((e as CustomEvent<KeyboardConfig>).detail);
    window.addEventListener(KEYBOARD_EVENT, onChange);
    return () => window.removeEventListener(KEYBOARD_EVENT, onChange);
  }, []);

  function setRing(cell: HTMLElement | null) {
    ringRef.current?.removeAttribute("data-kb-focus");
    ringRef.current = cell;
    cell?.setAttribute("data-kb-focus", "");
  }

  function showHint(text: string) {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(""), 1800);
  }

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function arm(onTimeout: () => void) {
    clearTimer();
    timerRef.current = setTimeout(onTimeout, TIMEOUT);
  }

  // End the pending command. With restore, focus goes back where it was before
  // the leader; otherwise the catcher is just blurred (Vimium resumes).
  function finish(restore = true) {
    clearTimer();
    phaseRef.current = null;
    setBadges([]);
    setHelpOpen(false);
    const prev = prevFocusRef.current;
    prevFocusRef.current = null;
    if (restore && prev && prev.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
    else catcherRef.current?.blur();
  }

  function focusCell(cell: HTMLElement) {
    clearTimer();
    phaseRef.current = null;
    setBadges([]);
    prevFocusRef.current = null;
    const widget = widgetIn(cell);
    if (!widget) { catcherRef.current?.blur(); return; }
    cell.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    setRing(cell);
    bestTarget(widget).focus({ preventScroll: true });
  }

  // The widget a command acts on: the one holding focus before the leader,
  // else the one wearing the ring.
  function focusedWidget(): { cell: HTMLElement; widget: HTMLElement } | null {
    const prev = prevFocusRef.current;
    const cell = (prev?.closest("[data-cell-index]") as HTMLElement | null) ?? ringRef.current;
    if (!cell || !cell.isConnected) return null;
    const widget = (prev?.closest("[data-widget-id]") as HTMLElement | null) ?? widgetIn(cell);
    return widget ? { cell, widget } : null;
  }

  function badgesFor(cells: HTMLElement[], only?: HTMLElement): Badge[] {
    const out: Badge[] = [];
    cells.forEach((cell, i) => {
      if (only && cell !== only) return;
      const r = cell.getBoundingClientRect();
      out.push({ key: `c${i}`, label: cellDigit(i), top: Math.max(4, r.top - 6), left: Math.max(4, r.left - 6), tab: false });
      tabButtons(cell).forEach((btn, t) => {
        const b = btn.getBoundingClientRect();
        out.push({
          key: `c${i}t${t}`,
          label: t < TAB_LETTERS.length ? `${t + 1} ${TAB_LETTERS[t]}` : String(t + 1),
          top: b.bottom + 2,
          left: b.left,
          tab: true,
        });
      });
    });
    return out;
  }

  function startLeader() {
    const active = document.activeElement;
    prevFocusRef.current = active instanceof HTMLElement ? active : null;
    phaseRef.current = { kind: "leader" };
    setBadges(badgesFor(visibleCells()));
    catcherRef.current?.focus({ preventScroll: true });
    arm(() => finish());
  }

  function runAction(action: KeyboardAction) {
    const { dashboards: d, onDashboardsChange: change, onToggleEdit: toggleEdit } = latest.current;
    if (action === "help") {
      clearTimer();
      phaseRef.current = { kind: "help" };
      setBadges([]);
      setHelpOpen(true);
      return;
    }
    if (action === "settings" || action === "refresh") {
      const target = focusedWidget();
      if (!target) { finish(); showHint("Focus a widget first: leader, then its number"); return; }
      const button = action === "settings"
        ? findButton(target.widget, '[data-widget-settings], button[aria-label="Settings"], button[title="Settings"]')
        : findButton(target.widget, '[data-widget-refresh], button[aria-label="Refresh now"]');
      if (!button) { finish(); showHint(action === "settings" ? "This widget has no settings" : "This widget has no refresh"); return; }
      if (action === "refresh") { button.click(); finish(); return; }
      finish(false);
      button.click();
      // Land on the first field of the settings face, else the widget itself.
      afterRender(() => focusCell(target.cell));
      return;
    }
    if (action === "editLayout") { finish(false); toggleEdit(); return; }
    if (action === "newDashboard") { finish(false); window.dispatchEvent(new Event(NEW_DASHBOARD_EVENT)); return; }
    if (!d || d.list.length < 2) { finish(); return; }
    const i = d.list.findIndex(x => x.id === d.activeId);
    const step = action === "nextDashboard" ? 1 : -1;
    finish(false);
    setRing(null);
    change({ ...d, activeId: d.list[(i + step + d.list.length) % d.list.length].id });
  }

  // Keys after the leader, read from the catcher (Vimium is in insert mode).
  function onCatcherKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    const phase = phaseRef.current;
    if (!phase || e.nativeEvent.isComposing) return;
    if (MODIFIERS.includes(e.key)) return;
    // Browser and Vimium shortcuts with modifiers are left alone.
    if (e.ctrlKey || e.metaKey || e.altKey) { finish(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (phase.kind === "help" || e.key === "Escape") { finish(); return; }

    if (phase.kind === "tab") {
      const tabs = tabButtons(phase.cell);
      const t = tabFromKey(e.key);
      if (t !== null && tabs[t]) {
        tabs[t].click();
        const cell = phase.cell;
        clearTimer();
        phaseRef.current = null;
        afterRender(() => focusCell(cell));
        return;
      }
      focusCell(phase.cell);
      return;
    }

    const n = cellFromKey(e.key);
    if (n !== null) {
      const cells = visibleCells();
      const cell = cells[n];
      if (!cell) { finish(); return; }
      if (tabButtons(cell).length > 1) {
        // A tab group waits for an optional tab key, then focuses.
        phaseRef.current = { kind: "tab", cell };
        setBadges(badgesFor(cells, cell));
        arm(() => focusCell(cell));
        return;
      }
      focusCell(cell);
      return;
    }

    const action = actionForKey(latest.current.config, e.key);
    if (action) runAction(action);
    else finish();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { config: cfg } = latest.current;
      if (!cfg.enabled || e.defaultPrevented || e.isComposing) return;
      if (e.target === catcherRef.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;

      // Escape drops keyboard focus from the ringed widget.
      if (e.key === "Escape") {
        const ring = ringRef.current;
        const active = document.activeElement;
        if (ring && active instanceof HTMLElement && ring.contains(active)) active.blur();
        setRing(null);
        return;
      }

      if (e.repeat || e.key !== cfg.leader || (cfg.leader === " " && e.shiftKey)) return;
      if (isEditableTarget(target)) return;
      // The settings drawer and other dialogs keep their own keys.
      if (target?.closest('[role="dialog"], [aria-modal="true"], dialog')) return;
      if (document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])')) return;
      e.preventDefault();
      startLeader();
    }
    // The ring follows real focus: it goes when focus leaves the cell for
    // anything but the catcher (click elsewhere, Tab away, Vimium's Escape).
    function onFocusOut() {
      setTimeout(() => {
        const ring = ringRef.current;
        if (!ring || !document.hasFocus()) return;
        const active = document.activeElement;
        if (active === catcherRef.current || (active && ring.contains(active))) return;
        setRing(null);
      }, 0);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusout", onFocusOut);
    };
  // The handlers read everything through refs; register once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { leader, bindings } = config;
  const L = keyLabel(leader);

  return (
    <>
      {/* The command catcher: focusable but off screen. While it has focus
          Vimium treats the page as typing and passes keys through. */}
      <input
        ref={catcherRef}
        aria-label="Keyboard command"
        tabIndex={-1}
        value=""
        onChange={() => {}}
        onKeyDown={onCatcherKey}
        onBlur={() => { if (phaseRef.current) { clearTimer(); phaseRef.current = null; setBadges([]); setHelpOpen(false); } }}
        autoComplete="off"
        inputMode="none"
        className="fixed -left-[9999px] top-0 w-px h-px opacity-0"
      />

      {badges.map(b => (
        <span
          key={b.key}
          aria-hidden
          style={{ top: b.top, left: b.left }}
          className={`fixed z-[60] pointer-events-none rounded-md shadow-md font-medium tabular-nums bg-[var(--text-primary)] text-[var(--surface)] ${b.tab ? "px-1 text-[11px]" : "px-1.5 py-0.5 text-[13px]"}`}
        >
          {b.label}
        </span>
      ))}

      {hint && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-3 py-1.5 rounded-full shadow-lg text-xs bg-[var(--text-primary)] text-[var(--surface)]">
          {hint}
        </div>
      )}

      {helpOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[2px] flex items-center justify-center p-4"
          onMouseDown={e => { e.preventDefault(); finish(); }}
        >
          <div aria-label="Keyboard shortcuts" className="w-full max-w-sm bg-[var(--surface)] border border-[var(--surface-border)] rounded-2xl shadow-2xl p-5 flex flex-col gap-3">
            <span className="text-[12px] uppercase tracking-widest text-[var(--text-muted)]">Keyboard shortcuts</span>
            <ul className="flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
              <li className="flex items-center justify-between gap-3"><span>Focus widget 1 to 10</span><Kbd>{`${L} 1..9, 0`}</Kbd></li>
              <li className="flex items-center justify-between gap-3"><span>Then pick a tab</span><Kbd>1..9 or q w e r t</Kbd></li>
              {KEYBOARD_ACTIONS.map(a => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span>{a.label}</span><Kbd>{`${L} ${keyLabel(bindings[a.id])}`}</Kbd>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3"><span>Cancel, or leave the widget</span><Kbd>Escape</Kbd></li>
            </ul>
            <p className="text-xs text-[var(--text-muted)]">Press any key to close.</p>
          </div>
        </div>
      )}
    </>
  );
}

// ── Settings > Keyboard ───────────────────────────────────────────────────

// Click the field (or press Enter on it), then press the new key. Escape
// cancels. It is a real input so Vimium lets the key through.
function KeyField({ value, label, onCapture }: { value: string; label: string; onCapture: (key: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  return (
    <input
      aria-label={`${label} key`}
      value={capturing ? "" : keyLabel(value)}
      placeholder="press a key"
      onChange={() => {}}
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={e => {
        if (e.key === "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        // Keep Escape from closing the drawer while capturing.
        e.stopPropagation();
        if (!capturing) { if (e.key === "Enter" || e.key === " ") setCapturing(true); return; }
        if (e.key === "Escape") { setCapturing(false); return; }
        if (!isBindableKey(e.key)) return;
        onCapture(e.key);
        setCapturing(false);
      }}
      className={`w-24 shrink-0 text-center text-xs border rounded-lg px-2 py-1 outline-none cursor-pointer bg-[var(--surface)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] ${capturing ? "border-[var(--text-muted)]" : "border-[var(--surface-border)]"}`}
    />
  );
}

export function KeyboardSettings() {
  const [config, setConfig] = useState<KeyboardConfig>(DEFAULT_KEYBOARD);

  useEffect(() => {
    loadKeyboardConfig().then(setConfig);
    const onChange = (e: Event) => setConfig((e as CustomEvent<KeyboardConfig>).detail);
    window.addEventListener(KEYBOARD_EVENT, onChange);
    return () => window.removeEventListener(KEYBOARD_EVENT, onChange);
  }, []);

  const update = (next: KeyboardConfig) => { setConfig(next); saveKeyboardConfig(next); };

  return (
    <section className="flex flex-col gap-3">
      <span className="text-[12px] uppercase tracking-widest text-[var(--text-muted)]">Keyboard</span>
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--text-secondary)]">Keyboard shortcuts</span>
        <Toggle checked={config.enabled} onChange={() => update({ ...config, enabled: !config.enabled })} label="Keyboard shortcuts" />
      </div>
      <p className="text-xs text-[var(--text-muted)] leading-relaxed -mt-1">
        Press the leader, then a widget&apos;s number to focus it, or a key below. Leader then ? lists them all. Works alongside Vimium.
      </p>
      {config.enabled && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--text-secondary)]">Leader</span>
            <KeyField value={config.leader} label="Leader" onCapture={k => update({ ...config, leader: k })} />
          </div>
          {KEYBOARD_ACTIONS.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--text-secondary)]">{a.label}</span>
              <KeyField value={config.bindings[a.id]} label={a.label} onCapture={k => update(rebind(config, a.id, k))} />
            </div>
          ))}
          <button
            onClick={() => update(DEFAULT_KEYBOARD)}
            className="self-start flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <RotateCcw size={12} />
            Reset to defaults
          </button>
        </div>
      )}
    </section>
  );
}
