import * as storage from "@/lib/storage";

// Keyboard navigation (components/KeyboardLayer). A leader key (Space by
// default) starts a short command: a digit focuses a widget, a letter runs an
// action. Built to coexist with Vimium, which binds most plain letters but
// passes every key through while an editable element has focus: on the leader
// the layer focuses a hidden input, so the keys that follow reach the page.
// See docs/keyboard.md.

export type KeyboardAction =
  | "options"
  | "fullScreen"
  | "moveLeft"
  | "moveDown"
  | "moveUp"
  | "moveRight"
  | "prevTab"
  | "nextTab"
  | "settings"
  | "refresh"
  | "prevDashboard"
  | "nextDashboard"
  | "newDashboard"
  | "editLayout"
  | "help";

export type KeyboardConfig = {
  enabled: boolean;
  leader: string;
  // Seconds a pending command (and the widget numbers) stays up after the leader.
  timeout: number;
  // The target mark: the ring on the widget that commands act on, shown for
  // `mark` seconds after a click or a keyboard pick, or kept on with markAlways.
  mark: number;
  markAlways: boolean;
  // A small dot on the target's corner that stays, so where commands land is
  // always visible without the leader.
  dot: boolean;
  // After a repeatable command (dashboards, tabs, moves) the leader stays
  // armed for `repeatWindow` seconds: the same kind of key again repeats it
  // without the leader (tmux's repeat), any other key is read as a command.
  repeat: boolean;
  repeatWindow: number;
  // "current": a widget number focuses the widget on the tab it shows, and
  // the tab keys step through tabs. "number": a tab number may follow the
  // widget number (the older two-digit scheme).
  tabMode: "current" | "number";
  bindings: Record<KeyboardAction, string>;
};
export const TIMEOUT_RANGE = { min: 0.5, max: 10, step: 0.5 };
export const REPEAT_RANGE = { min: 0.5, max: 3, step: 0.25 };

// One setting key for the whole config. Settings > Keyboard writes it and fires
// KEYBOARD_EVENT (detail: KeyboardConfig) so the layer applies it at once.
export const KEYBOARD_KEY = "keyboard-config";
export const KEYBOARD_EVENT = "keyboardconfigchange";
// Asks the dashboard switcher to open in create mode (the name prompt).
export const NEW_DASHBOARD_EVENT = "keyboardnewdashboard";

// Order here is the order in Settings > Keyboard and the cheat sheet.
export const KEYBOARD_ACTIONS: { id: KeyboardAction; label: string }[] = [
  { id: "moveLeft",      label: "Widget to the left" },
  { id: "moveDown",      label: "Widget below" },
  { id: "moveUp",        label: "Widget above" },
  { id: "moveRight",     label: "Widget to the right" },
  { id: "prevTab",       label: "Previous tab of the focused widget" },
  { id: "nextTab",       label: "Next tab of the focused widget" },
  { id: "options",       label: "Options of the focused widget (the header toggle)" },
  { id: "fullScreen",    label: "Full screen for the focused widget" },
  { id: "settings",      label: "Settings of the focused widget" },
  { id: "refresh",       label: "Refresh the focused widget" },
  { id: "prevDashboard", label: "Previous dashboard" },
  { id: "nextDashboard", label: "Next dashboard" },
  { id: "newDashboard",  label: "New dashboard" },
  { id: "editLayout",    label: "Toggle layout editing" },
  { id: "help",          label: "Show shortcuts" },
];

export const DEFAULT_KEYBOARD: KeyboardConfig = {
  enabled: true,
  leader: " ",
  timeout: 1.5,
  mark: 3,
  markAlways: false,
  dot: true,
  repeat: true,
  repeatWindow: 1,
  tabMode: "current",
  bindings: {
    moveLeft: "h",
    moveDown: "j",
    moveUp: "k",
    moveRight: "l",
    prevTab: ",",
    nextTab: ".",
    options: "o",
    fullScreen: "f",
    settings: "e",
    refresh: "r",
    prevDashboard: "[",
    nextDashboard: "]",
    newDashboard: "n",
    editLayout: "g",
    help: "?",
  },
};

// Commands the repeat window applies to: stepping through something.
export const REPEATABLE: KeyboardAction[] = ["moveLeft", "moveDown", "moveUp", "moveRight", "prevTab", "nextTab", "prevDashboard", "nextDashboard"];

// Arrow keys always move, whatever the letter bindings.
export const ARROW_ACTIONS: Record<string, KeyboardAction> = {
  ArrowLeft: "moveLeft", ArrowDown: "moveDown", ArrowUp: "moveUp", ArrowRight: "moveRight",
};

// Defaults an action had before, so a stored config still holding one can be
// moved off a key a newer action now claims (layout editing was "l" before
// the moves took h j k l).
const PREVIOUS_DEFAULTS: Partial<Record<KeyboardAction, string>> = { editLayout: "l" };

// Widgets are numbered 1..9 then 0, so only the first ten cells of a dashboard
// get a number (a two-digit scheme would clash with the tab key that follows).
// Tabs inside a group take 1..9.
export const MAX_CELLS = 10;
export const MAX_TABS = 9;

// Digit shown for the cell at a 0-based position: 1..9, then 0 for the 10th.
export function cellDigit(index: number): string {
  return index === 9 ? "0" : String(index + 1);
}

export function cellFromKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return key === "0" ? 9 : Number(key) - 1;
}

export function tabFromKey(key: string): number | null {
  return /^[1-9]$/.test(key) ? Number(key) - 1 : null;
}

// Single printable characters only. Digits are reserved for widget numbers.
export function isBindableKey(key: string): boolean {
  return key.length === 1 && !/^[0-9]$/.test(key);
}

export function keyLabel(key: string): string {
  if (key === " ") return "Space";
  if (!key) return "none";
  return key;
}

// Assign a key to an action. If another action already used it, the two trade
// keys, so no binding is ever silently shadowed.
export function rebind(config: KeyboardConfig, action: KeyboardAction, key: string): KeyboardConfig {
  const bindings = { ...config.bindings };
  const clash = KEYBOARD_ACTIONS.find(a => a.id !== action && bindings[a.id] === key);
  if (clash) bindings[clash.id] = bindings[action];
  bindings[action] = key;
  return { ...config, bindings };
}

export function actionForKey(config: KeyboardConfig, key: string): KeyboardAction | null {
  return KEYBOARD_ACTIONS.find(a => config.bindings[a.id] === key)?.id ?? ARROW_ACTIONS[key] ?? null;
}

// Tolerant parse: anything missing or invalid falls back to the default, so an
// older stored config gains new actions without a migration.
export function parseKeyboardConfig(raw: string | null): KeyboardConfig {
  let parsed: Partial<KeyboardConfig> | null = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || typeof parsed !== "object") return DEFAULT_KEYBOARD;
  const bindings = { ...DEFAULT_KEYBOARD.bindings };
  const stored = new Set<KeyboardAction>();
  for (const { id } of KEYBOARD_ACTIONS) {
    const k = parsed.bindings?.[id];
    if (typeof k === "string" && isBindableKey(k)) { bindings[id] = k; stored.add(id); }
  }
  // An action new since the config was saved takes its default key. If a
  // stored binding already holds that key and it is that action's old
  // default, the old action moves to its new default; a key the user chose
  // wins, and the new action is left unbound instead.
  for (const { id } of KEYBOARD_ACTIONS) {
    if (stored.has(id)) continue;
    const holder = KEYBOARD_ACTIONS.find(a => a.id !== id && stored.has(a.id) && bindings[a.id] === bindings[id]);
    if (!holder) continue;
    const freed = DEFAULT_KEYBOARD.bindings[holder.id];
    const taken = KEYBOARD_ACTIONS.some(a => a.id !== holder.id && bindings[a.id] === freed);
    if (PREVIOUS_DEFAULTS[holder.id] === bindings[id] && !taken) bindings[holder.id] = freed;
    else bindings[id] = "";
  }
  const seconds = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== null && v !== "" ? Math.min(TIMEOUT_RANGE.max, Math.max(TIMEOUT_RANGE.min, n)) : fallback;
  };
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
    leader: typeof parsed.leader === "string" && isBindableKey(parsed.leader) ? parsed.leader : DEFAULT_KEYBOARD.leader,
    timeout: seconds(parsed.timeout, DEFAULT_KEYBOARD.timeout),
    mark: seconds(parsed.mark, DEFAULT_KEYBOARD.mark),
    markAlways: typeof parsed.markAlways === "boolean" ? parsed.markAlways : false,
    dot: typeof parsed.dot === "boolean" ? parsed.dot : DEFAULT_KEYBOARD.dot,
    repeat: typeof parsed.repeat === "boolean" ? parsed.repeat : DEFAULT_KEYBOARD.repeat,
    repeatWindow: (() => {
      const n = Number(parsed.repeatWindow);
      return Number.isFinite(n) && parsed.repeatWindow != null ? Math.min(REPEAT_RANGE.max, Math.max(REPEAT_RANGE.min, n)) : DEFAULT_KEYBOARD.repeatWindow;
    })(),
    tabMode: parsed.tabMode === "number" ? "number" : "current",
    bindings,
  };
}

export async function loadKeyboardConfig(): Promise<KeyboardConfig> {
  return parseKeyboardConfig(await storage.getItem(KEYBOARD_KEY));
}

export function saveKeyboardConfig(config: KeyboardConfig) {
  storage.setItem(KEYBOARD_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, { detail: config }));
}

// Where keys belong to the element, not the layer: text fields, selects,
// contenteditable, and typing surfaces marked [data-autofocus] (the typing
// widget's field is a focusable div that handles its own keys).
export function isEditableTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.hasAttribute("data-autofocus")) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"].includes(el.type);
  }
  return false;
}
