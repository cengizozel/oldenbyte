# Keyboard navigation

The dashboard can be driven from the keyboard: focus a widget by number, open its settings, refresh it, switch dashboards, toggle layout editing. Everything goes through a leader key so it never collides with typing or with Vimium.

Code: `lib/keyboard.ts` (types, defaults, load/save, key helpers) and `components/KeyboardLayer.tsx` (the listener, the command catcher, badges, cheat sheet, and the Settings > Keyboard section), mounted once from `app/page.tsx`.

## Bindings

Defaults, all pressed after the leader (**Space**):

| Keys | Action |
|---|---|
| `1`..`9`, `0` | Focus widget 1 to 10 of the visible dashboard |
| then `1`..`9` or `q w e r t` | In a tab group: pick that tab (q w e r t are tabs 1 to 5) |
| `e` | Open the settings of the focused widget |
| `r` | Refresh the focused widget |
| `[` / `]` | Previous / next dashboard |
| `n` | New dashboard (opens the switcher at the name prompt) |
| `l` | Toggle layout editing |
| `?` | Cheat sheet with the current bindings (any key closes it) |
| `Escape` | Cancel a pending command; on a focused widget, leave it |

While the leader is pending, every widget shows its number and every tab group shows its tab keys. A pending command times out after 1.5 seconds. In a tab group, if no tab key follows within that time (or another key arrives), the current tab is focused.

Numbering follows reading order: top to bottom, then left to right, by each widget's position in the layout. Only the first ten widgets get a number (1..9, then 0); a two-digit scheme would be ambiguous with the tab key that follows. Tab groups number up to nine tabs. Numbers apply to the visible dashboard only, and not while editing the layout.

Focusing a widget scrolls it into view, draws a ring around its cell, and moves focus to the best target inside it: the first element marked `data-autofocus` (the typing field, the chat composer, today's notepad page), else its first text field, else the widget itself. The ring follows real focus and goes away when focus leaves the widget.

`e` and `r` act on the widget that held focus when the leader was pressed (or the one wearing the ring). They click the widget's settings button (`data-widget-settings` on `PencilButton`, or a button labeled "Settings") or its "Refresh now" button; a widget without one shows a short hint. After opening settings, focus lands on the first field of the settings face.

## Vimium compatibility

Vimium's content script sees key events before the page and binds most plain letters, so a page cannot use letters as shortcuts while Vimium is active. Two facts make this work anyway:

- Vimium does not bind Space, so the leader always reaches the page.
- Vimium passes every key through while an editable element has focus (insert mode).

So on the leader the layer calls `preventDefault` (no page scroll) and focuses the command catcher: a visually hidden input positioned off screen (`aria-label="Keyboard command"`). Vimium sees an input focused and enters insert mode, and the keys that follow are read from the catcher's keydown. When the command finishes, is cancelled, or times out, the catcher is blurred (or focus moves to the widget the command targeted) and Vimium is back in normal mode. The cheat sheet also keeps the catcher focused, which is why any key can close it.

The leader is ignored when:

- the focused element is editable (input, textarea, select, contenteditable, or a `data-autofocus` typing surface), so Space types normally;
- the settings drawer is open, or focus is inside another dialog;
- Ctrl, Meta or Alt is held (browser and Vimium shortcuts are left alone), or the key repeats.

Space on a focused button starts the leader rather than pressing the button; Enter still presses it.

Note that the typing widget's field is a focusable element rather than a text input, so Vimium does not enter insert mode for it on its own; if Vimium swallows letters there, add the dashboard to Vimium's excluded keys or sites.

## Rebinding

Settings > Keyboard has an on/off switch (default on), the leader, and one field per action. Click a field (or press Enter on it) and press the new key; Escape cancels. Keys are single characters; digits are reserved for widget numbers. Giving an action a key that another action already uses swaps the two. "Reset to defaults" restores the table above.

The config is stored per user under the `keyboard-config` setting as `{ enabled, leader, bindings: { [actionId]: key } }`. The layer reads it at startup and applies changes immediately through the `keyboardconfigchange` window event. A leader other than Space should be a key Vimium does not bind, or Vimium will take it first.
