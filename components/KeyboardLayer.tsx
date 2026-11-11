"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { RotateCcw, ChevronDown } from "lucide-react";
import type { DashboardsState } from "@/lib/dashboards";
import {
  DEFAULT_KEYBOARD, KEYBOARD_ACTIONS, KEYBOARD_EVENT, NEW_DASHBOARD_EVENT, MAX_CELLS, MAX_TABS,
  cellDigit, cellFromKey, tabFromKey, actionForKey, isBindableKey, isEditableTarget, keyLabel, rebind,
  loadKeyboardConfig, saveKeyboardConfig, TIMEOUT_RANGE, type KeyboardAction, type KeyboardConfig,
} from "@/lib/keyboard";
import Toggle from "@/components/ui/Toggle";
import { exitDemoMode, isDemoMode } from "@/lib/demo";
import { FOCUS_RING, SettingsRow, SettingsSection, Stepper } from "@/components/ui/Field";

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

const MODIFIERS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"];
const FOCUSABLE_FIELDS =
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=file]):not([type=color]), textarea, select, [contenteditable='true'], [contenteditable='']";

type Badge = { key: string; label: string; top: number; left: number; tab: boolean; target: boolean };
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

// A header action (settings, refresh, full screen): it sits on the options
// face, inert while the face is closed, but laid out, and a programmatic
// click works there; only hidden members (display none) are skipped. So the
// keys work with the options closed.
function findHeaderAction(cell: HTMLElement, selector: string): HTMLElement | null {
  return Array.from(cell.querySelectorAll<HTMLElement>(selector))
    .find(el => el.getClientRects().length > 0 && !(el as HTMLButtonElement).disabled) ?? null;
}

// Lets React commit a state change (tab switch, settings flip) before focusing.
function afterRender(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded-md border border-[var(--surface-border)] text-xs text-[var(--text-muted)] whitespace-nowrap">
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
  // The cell wearing the mark ([data-kb-focus], styled in globals.css).
  const ringRef = useRef<HTMLElement | null>(null);
  // The target: the tile commands act on. A click on a card or a keyboard
  // pick sets it and shows the mark for a few seconds (or for good, by
  // setting); the mark also shows while a command is pending, so the leader
  // always tells you what o, f, e and r would hit.
  const targetRef = useRef<HTMLElement | null>(null);
  const markTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest props for the listeners registered once below.
  const latest = useRef({ config, dashboards, onDashboardsChange, onToggleEdit });
  useEffect(() => { latest.current = { config, dashboards, onDashboardsChange, onToggleEdit }; });

  useEffect(() => {
    loadKeyboardConfig().then(setConfig);
    const onChange = (e: Event) => setConfig((e as CustomEvent<KeyboardConfig>).detail);
    window.addEventListener(KEYBOARD_EVENT, onChange);
    return () => window.removeEventListener(KEYBOARD_EVENT, onChange);
  }, []);
  // Settings flip: keep the mark on the target, or let it go.
  useEffect(() => {
    const target = targetRef.current;
    if (config.markAlways) { clearMarkTimer(); if (target?.isConnected) setRing(target); }
    else if (!markTimerRef.current) setRing(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.markAlways]);

  function setRing(cell: HTMLElement | null) {
    ringRef.current?.removeAttribute("data-kb-focus");
    ringRef.current = cell;
    cell?.setAttribute("data-kb-focus", "");
  }

  function clearMarkTimer() {
    if (markTimerRef.current) clearTimeout(markTimerRef.current);
    markTimerRef.current = null;
  }

  function showMark(cell: HTMLElement) {
    targetRef.current = cell;
    setRing(cell);
    clearMarkTimer();
    const { mark, markAlways } = latest.current.config;
    if (!markAlways) markTimerRef.current = setTimeout(() => { markTimerRef.current = null; setRing(null); }, mark * 1000);
  }

  // The mark is only a moment's feedback unless kept on: when a pending
  // command ends with no fresh pick, it goes.
  function settleMark() {
    if (!markTimerRef.current && !latest.current.config.markAlways) setRing(null);
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
    timerRef.current = setTimeout(onTimeout, latest.current.config.timeout * 1000);
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
    settleMark();
  }

  function focusCell(cell: HTMLElement) {
    clearTimer();
    phaseRef.current = null;
    setBadges([]);
    prevFocusRef.current = null;
    const widget = widgetIn(cell);
    if (!widget) { catcherRef.current?.blur(); return; }
    cell.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    showMark(cell);
    bestTarget(widget).focus({ preventScroll: true });
  }

  // The widget a command acts on: the one holding focus before the leader,
  // else the target.
  function focusedWidget(): { cell: HTMLElement; widget: HTMLElement } | null {
    const prev = prevFocusRef.current;
    const target = targetRef.current?.isConnected ? targetRef.current : null;
    const cell = (prev?.closest("[data-cell-index]") as HTMLElement | null) ?? target;
    if (!cell || !cell.isConnected) return null;
    const widget = (prev?.closest("[data-widget-id]") as HTMLElement | null) ?? widgetIn(cell);
    return widget ? { cell, widget } : null;
  }

  function badgesFor(cells: HTMLElement[], only?: HTMLElement): Badge[] {
    const out: Badge[] = [];
    cells.forEach((cell, i) => {
      if (only && cell !== only) return;
      const r = cell.getBoundingClientRect();
      out.push({ key: `c${i}`, label: cellDigit(i), top: Math.max(4, r.top - 6), left: Math.max(4, r.left - 6), tab: false, target: cell === targetRef.current });
      tabButtons(cell).forEach((btn, t) => {
        const b = btn.getBoundingClientRect();
        out.push({
          key: `c${i}t${t}`,
          label: String(t + 1),
          top: b.bottom + 2,
          left: b.left,
          tab: true,
          target: false,
        });
      });
    });
    return out;
  }

  function startLeader() {
    const active = document.activeElement;
    prevFocusRef.current = active instanceof HTMLElement ? active : null;
    phaseRef.current = { kind: "leader" };
    // The current target wears the mark for as long as the command is pending.
    const target = targetRef.current;
    if (target?.isConnected) { clearMarkTimer(); setRing(target); }
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
    if (action === "options" || action === "fullScreen") {
      // Both live in the header: the toggle, and the full screen button on
      // the options face (clicked where it stands, open face or not).
      const target = focusedWidget();
      if (!target) { finish(); showHint("Focus a widget first: leader, then its number"); return; }
      const button = action === "options"
        ? findButton(target.cell, 'button[aria-label="Options"], button[aria-label="Close options"]')
        : findHeaderAction(target.cell, 'button[aria-label="Full screen"], button[aria-label="Exit full screen (Esc)"]');
      if (!button) { finish(); showHint(action === "options" ? "This widget has no options" : "Full screen is not available here"); return; }
      showMark(target.cell);
      finish(false);
      button.click();
      afterRender(() => focusCell(target.cell));
      return;
    }
    if (action === "settings" || action === "refresh") {
      const target = focusedWidget();
      if (!target) { finish(); showHint("Focus a widget first: leader, then its number"); return; }
      const button = action === "settings"
        ? findHeaderAction(target.cell, "[data-widget-settings]")
        : findHeaderAction(target.cell, '[data-widget-refresh], button[aria-label="Refresh now"]');
      if (!button) { finish(); showHint(action === "settings" ? "This widget has no settings" : "This widget has no refresh"); return; }
      showMark(target.cell);
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
    // Browser and Vimium shortcuts with Ctrl or Meta are left alone. Alt is
    // allowed: on many layouts brackets and other symbols are typed with
    // AltGr, which reports as Alt, and only the pending leader is listening.
    if (e.ctrlKey || e.metaKey) { finish(); return; }
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

      // Escape drops keyboard focus from the ringed widget. Otherwise, outside
      // a field or a dialog, it leaves demo mode (a reload does too).
      if (e.key === "Escape") {
        const ring = ringRef.current;
        const active = document.activeElement;
        if (ring && active instanceof HTMLElement && ring.contains(active)) { active.blur(); setRing(null); return; }
        setRing(null);
        if (isDemoMode() && !isEditableTarget(target) && !target?.closest('[role="dialog"], [aria-modal="true"], dialog')) exitDemoMode();
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
    // A click on a card picks it: the mark shows there for a moment.
    function onPointerDown(e: PointerEvent) {
      if (!latest.current.config.enabled) return;
      const cell = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-cell-index]") : null;
      if (cell) showMark(cell);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
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
          className={`fixed z-[60] pointer-events-none rounded-md shadow-md font-medium tabular-nums bg-[var(--text-primary)] text-[var(--surface)] ${b.tab ? "px-1 text-xs" : "px-1.5 py-0.5 text-sm"} ${b.target ? "ring-2 ring-[var(--text-muted)] ring-offset-2 ring-offset-[var(--surface)]" : ""}`}
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
            <span className="text-sm text-[var(--text-muted)]">Keyboard shortcuts</span>
            <ul className="flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
              <li className="flex items-center justify-between gap-3"><span>Focus widget 1 to 10</span><Kbd>{`${L} 1..9, 0`}</Kbd></li>
              <li className="flex items-center justify-between gap-3"><span>Then pick a tab</span><Kbd>1..9</Kbd></li>
              {KEYBOARD_ACTIONS.map(a => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span>{a.label}</span><Kbd>{`${L} ${keyLabel(bindings[a.id])}`}</Kbd>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3"><span>Cancel, or leave the widget</span><Kbd>Escape</Kbd></li>
            </ul>
            <p className="text-sm text-[var(--text-muted)]">Press any key to close.</p>
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
      className={`w-24 shrink-0 h-7 text-center text-sm border rounded-lg px-2 outline-none cursor-pointer bg-[var(--surface)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] ${capturing ? "border-[var(--text-muted)]" : "border-[var(--surface-border)]"}`}
    />
  );
}

export function KeyboardSettings() {
  const [config, setConfig] = useState<KeyboardConfig>(DEFAULT_KEYBOARD);
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    loadKeyboardConfig().then(setConfig);
    const onChange = (e: Event) => setConfig((e as CustomEvent<KeyboardConfig>).detail);
    window.addEventListener(KEYBOARD_EVENT, onChange);
    return () => window.removeEventListener(KEYBOARD_EVENT, onChange);
  }, []);

  const update = (next: KeyboardConfig) => { setConfig(next); saveKeyboardConfig(next); };

  return (
    <SettingsSection title="Keyboard">
      <SettingsRow label="Shortcuts" hint={`${keyLabel(config.leader)}, then a widget number or a key. ? lists them.`}>
        <Toggle checked={config.enabled} onChange={() => update({ ...config, enabled: !config.enabled })} label="Keyboard shortcuts" />
      </SettingsRow>
      {config.enabled && (
        <SettingsRow label="Time to answer" hint={`Seconds the widget numbers stay up after ${keyLabel(config.leader)}.`}>
          <Stepper
            label="seconds a command waits after the leader"
            value={config.timeout}
            min={TIMEOUT_RANGE.min}
            max={TIMEOUT_RANGE.max}
            step={TIMEOUT_RANGE.step}
            unit="s"
            onChange={v => update({ ...config, timeout: v })}
          />
        </SettingsRow>
      )}
      {config.enabled && (
        <SettingsRow label="Target mark" hint="The ring on the widget your commands act on, after a click or a pick.">
          <Toggle checked={config.markAlways} onChange={() => update({ ...config, markAlways: !config.markAlways })} label="Always shown" />
        </SettingsRow>
      )}
      {config.enabled && (
        <SettingsRow label="Mark stays for" hint={config.markAlways ? "Always shown, so this does not apply." : "Seconds, then it fades."}>
          <Stepper
            label="seconds the target mark stays"
            value={config.mark}
            min={TIMEOUT_RANGE.min}
            max={TIMEOUT_RANGE.max}
            step={TIMEOUT_RANGE.step}
            unit="s"
            disabled={config.markAlways}
            onChange={v => update({ ...config, mark: v })}
          />
        </SettingsRow>
      )}
      {config.enabled && (
        <div className="flex flex-col py-1.5">
          <button
            onClick={() => setShowKeys(o => !o)}
            aria-expanded={showKeys}
            className={`flex items-center justify-between gap-3 min-h-7 text-sm text-[var(--text-primary)] ${FOCUS_RING}`}
          >
            <span>Change keys</span>
            <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${showKeys ? "rotate-180" : ""}`} />
          </button>
          {showKeys && (
            <div className="flex flex-col gap-2 pt-2 pb-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--text-secondary)]">Leader</span>
                <KeyField value={config.leader} label="Leader" onCapture={k => update({ ...config, leader: k })} />
              </div>
              {KEYBOARD_ACTIONS.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--text-secondary)]">{a.label}</span>
                  <KeyField value={config.bindings[a.id]} label={a.label} onCapture={k => update(rebind(config, a.id, k))} />
                </div>
              ))}
              <button
                onClick={() => update(DEFAULT_KEYBOARD)}
                className={`self-start flex items-center gap-1.5 min-h-6 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors ${FOCUS_RING}`}
              >
                <RotateCcw size={14} />
                Reset to defaults
              </button>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
