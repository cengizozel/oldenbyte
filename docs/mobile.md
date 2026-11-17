# Phones

On a phone-width window (under 600px) the dashboard stacks its widgets in one column, in reading order, and tab groups swipe. Two things make a long stack quick to get around: the overview and the jump button.

Code: `components/MobileNav.tsx` (the button, `usePhone`, the Settings > Phone section) and the "Phone overview" block in `components/WidgetGrid.tsx`.

## The jump button

A floating round button with the oldenbyte mark, like iOS AssistiveTouch. It is shown on the visible dashboard, on phones only, and not while editing the layout or with a widget in full screen.

- Tap: open the overview (tap again to go back to where you were).
- Drag: move it. It settles on the nearer side edge and remembers the spot on this device (`localStorage`, key `oldenbyte-jump-pos`).
- Hold (about a quarter of a second without moving): every widget's name appears in a column beside the button. Slide up or down and the name level with your thumb is picked, so the name is beside the thumb, not under it (the gesture of a contacts index). The phone ticks once per name where it can vibrate. Let go to jump there; a tab group's members are listed under its first tab, and jumping to one selects that tab. Letting go without sliding, or after sliding far away sideways, cancels.

A jump scrolls the widget to the top and rings it for a moment.

Settings > Phone > Jump button turns it off (setting `mobile-jump`, on unless `"0"`).

## The overview

The desktop arrangement of the dashboard, live, scaled down to fit the phone: the same grid you see on a wide screen, with every widget still running, and a readable name on each tile. Tap a tile to zoom into it; you land on that widget in the stacked list.

How it works: the grid is laid out 1200px wide (so the full four-column layout renders) and a CSS transform scales it to the screen width. Widgets are never remounted, since each renders once into its own node and the layouts only adopt those nodes. Opening starts the transform at the widget that was on screen and animates out to the fitted view; a tap animates in to the chosen tile, then the stacked list returns with that widget placed where its zoomed tile was. The layout variant is forced by the overview state rather than by the measured width, so the switch and the transform land in the same paint and nothing flashes. A row is capped at 520px of layout height so a two-row dashboard is not stretched down the whole phone; shorter overviews are centered.

Rotating the phone, entering layout editing or switching dashboards closes the overview.

Touch taps do not move the keyboard target (the teal logo and ring are for a keyboard).
