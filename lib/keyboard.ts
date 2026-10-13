import * as storage from "@/lib/storage";

// Keyboard navigation (components/KeyboardLayer). A leader key (Space by
// default) starts a short command: a digit focuses a widget, a letter runs an
// action. Built to coexist with Vimium, which binds most plain letters but
// passes every key through while an editable element has focus: on the leader
// the layer focuses a hidden input, so the keys that follow reach the page.
// See docs/keyboard.md.

export type KeyboardAction =
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
  bindings: Record<KeyboardAction, string>;
};

// One setting key for the whole config. Settings > Keyboard writes it and fires
// KEYBOARD_EVENT (detail: KeyboardConfig) so the layer applies it at once.
export const KEYBOARD_KEY = "keyboard-config";
export const KEYBOARD_EVENT = "keyboardconfigchange";
// Asks the dashboard switcher to open in create mode (the name prompt).
export const NEW_DASHBOARD_EVENT = "keyboardnewdashboard";

// Order here is the order in Settings > Keyboard and the cheat sheet.
export const KEYBOARD_ACTIONS: { id: KeyboardAction; label: string }[] = [
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
  bindings: {
    settings: "e",
    refresh: "r",
    prevDashboard: "[",
    nextDashboard: "]",
    newDashboard: "n",
    editLayout: "l",
    help: "?",
  },
};

// Widgets are numbered 1..9 then 0, so only the first ten cells of a dashboard
// get a number (a two-digit scheme would clash with the tab key that follows).
// Tabs inside a group take 1..9, or q w e r t for the first five.
export const MAX_CELLS = 10;
export const MAX_TABS = 9;
export const TAB_LETTERS = ["q", "w", "e", "r", "t"];

// Digit shown for the cell at a 0-based position: 1..9, then 0 for the 10th.
export function cellDigit(index: number): string {
  return index === 9 ? "0" : String(index + 1);
}

export function cellFromKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return key === "0" ? 9 : Number(key) - 1;
}

export function tabFromKey(key: string): number | null {
  if (/^[1-9]$/.test(key)) return Number(key) - 1;
  const i = TAB_LETTERS.indexOf(key);
  return i >= 0 ? i : null;
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
  return KEYBOARD_ACTIONS.find(a => config.bindings[a.id] === key)?.id ?? null;
}

// Tolerant parse: anything missing or invalid falls back to the default, so an
// older stored config gains new actions without a migration.
export function parseKeyboardConfig(raw: string | null): KeyboardConfig {
  let parsed: Partial<KeyboardConfig> | null = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || typeof parsed !== "object") return DEFAULT_KEYBOARD;
  const bindings = { ...DEFAULT_KEYBOARD.bindings };
  for (const { id } of KEYBOARD_ACTIONS) {
    const k = parsed.bindings?.[id];
    if (typeof k === "string" && isBindableKey(k)) bindings[id] = k;
  }
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
    leader: typeof parsed.leader === "string" && isBindableKey(parsed.leader) ? parsed.leader : DEFAULT_KEYBOARD.leader,
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
