# Keyboard navigation

The dashboard can be driven from the keyboard: focus a widget by number, open its settings, refresh it, switch dashboards, toggle layout editing. Everything goes through a leader key so it never collides with typing or with Vimium.

Code: `lib/keyboard.ts` (types, defaults, load/save, key helpers) and `components/KeyboardLayer.tsx` (the listener, the command catcher, badges, cheat sheet, and the Settings > Keyboard section), mounted once from `app/page.tsx`.

## Bindings

Defaults, all pressed after the leader (**Space**):

| Keys | Action |
|---|---|
| `1`..`9`, `0` | Focus widget 1 to 10 of the visible dashboard, on the tab it shows |
| `h` `j` `k` `l`, or the arrows | Move the target to the widget left, below, above or right |
| `,` / `.` | Previous / next tab of the target |
| `o` | Options of the focused widget (its header toggle) |
| `f` | Full screen for the focused widget (Escape leaves it) |
| `e` | Open the settings of the focused widget |
| `r` | Refresh the focused widget |
| `[` / `]` | Previous / next dashboard |
| `n` | New dashboard (opens the switcher at the name prompt) |
| `g` | Toggle layout editing (it was `l` before the moves took `h j k l`; a saved config still holding `l` moves to `g`) |
| `s` | Open Settings (Escape closes it) |
| `?` | Cheat sheet with the current bindings (any key closes it) |
| `Escape` | Cancel a pending command; on a focused widget, leave it |

Moves are spatial, as on a TV remote: the nearest widget past the target in that direction, preferring one in the same row (or column). They reach every widget, numbered or not. A move or a tab step moves the target (and its teal logo and ring), not the text cursor: putting the cursor in a note would make the next leader type a space. A number still focuses the widget's text field, ready to type.

Repeat: after a move, a tab step or a dashboard switch, the leader stays armed for the repeat window (1 second by default): pressing any of those keys again repeats without the leader, so `Space ] ]` goes two dashboards right and `Space l l j` walks the grid. Any other command key in the window runs as a fresh command on the widget just reached; any other key closes the window. Settings > Keyboard > Repeat keys turns it off, Repeat window sets the seconds (0.5 to 3).

Holding the leader: while it is held down, nothing times out. Moves, tab steps and dashboard keys keep working for as long as it is held, and a widget number only marks the widget (its teal logo and ring) so the following keys are not typed into it; letting go of the leader focuses the last widget picked. The leader's own auto-repeat is ignored. Tapping works exactly as before, with the timeouts, so the two never conflict: the layer watches the leader's key-up (and a window blur, which swallows it). Settings > Keyboard > Hold to keep going turns it off.

Tabs: Settings > Keyboard > Tabs picks how a tab group is reached. Tab keys (default): the widget number focuses the tab the group shows, at once, and `,` / `.` step through its tabs. Tab numbers: the older scheme, where a tab number may follow the widget number (`Space 2 2`), at the cost of a short wait after the widget number.

The target logo: the oldenbyte mark in the target's header (its options toggle) becomes a filled teal badge for as long as it is the target, so you can see where commands land without pressing the leader. Darker teal on light cards, the logo's own teal in dark and grey; the ring uses the same teal. Touch taps do not set the target. Settings > Keyboard > Target logo turns it off.

While the leader is pending, every widget shows its number and every tab group shows its tab keys. Settings > Keyboard > Widget numbers hides them (`badges` in the config); the keys work the same. A pending command times out after 1.5 seconds by default; Settings > Keyboard > Time to answer sets it (0.5 to 10 seconds, stored in the same config as `timeout`).

The widget that `o`, `f`, `e` and `r` act on is the target: the last widget picked with the leader and its number, or the last card clicked. Picking or clicking draws the mark (a ring round the card) for 3 seconds by default, and while the leader is pending the mark is back on the target and its number badge is ringed, so you always see what a command would hit. Settings > Keyboard > Target mark keeps it on permanently (Always shown), and Mark stays for sets the seconds otherwise (`mark` and `markAlways` in the config). In a tab group, if no tab key follows within that time (or another key arrives), the current tab is focused.

Numbering follows reading order: top to bottom, then left to right, by each widget's position in the layout. Only the first ten widgets get a number (1..9, then 0); a two-digit scheme would be ambiguous with the tab key that follows. Tab groups number up to nine tabs. Numbers apply to the visible dashboard only, and not while editing the layout.

Focusing a widget scrolls it into view, draws a ring around its cell, and moves focus to the best target inside it: the first element marked `data-autofocus` (the typing field, the chat composer, today's notepad page), else its first text field, else the widget itself. The ring follows real focus and goes away when focus leaves the widget.

In layout editing, Escape does what the cross does: it leaves editing at once when nothing changed, and otherwise asks first ("Changes not saved", with Go back focused and Discard changes). Escape in that dialog goes back to editing. Text fields, menus and dialogs keep their own Escape.

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

The config is stored per user under the `keyboard-config` setting as `{ enabled, leader, timeout, mark, markAlways, dot, repeat, repeatWindow, hold, badges, tabMode, bindings: { [actionId]: key } }`. An action added after a config was saved takes its default key; if the user's own binding already holds that key, theirs wins and the new action stays unbound until they give it one. The layer reads it at startup and applies changes immediately through the `keyboardconfigchange` window event. A leader other than Space should be a key Vimium does not bind, or Vimium will take it first.
