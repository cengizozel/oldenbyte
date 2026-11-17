# Phones

On a phone-width window (under 600px) the dashboard stacks its widgets in one column, in reading order, and tab groups swipe. Two things make a long stack quick to get around: the overview and the jump button.

Code: `components/MobileNav.tsx` (the button, `usePhone`, the Settings > Phone section), `components/PhoneTabBar.tsx` and the phone branch of `components/TopBar.tsx` (the frame), and the "Phone overview" block in `components/WidgetGrid.tsx`.

## Install it like an app

The dashboard is an installable web app. Open it in the phone's browser and add it to the home screen:

- iPhone and iPad (Safari): Share, then Add to Home Screen.
- Android (Chrome): the menu, then Install app or Add to Home screen.
- Desktop Chrome and Edge offer Install in the address bar too.

It then has its own icon and opens full screen, without the browser's bars. On an iPhone the installed app keeps its own sign-in, separate from Safari's, so sign in once inside it.

What this is not: it does not work offline (there is no service worker; the dashboard needs its server), and it is not in an app store. A store app is a separate project.

The pieces: `app/manifest.ts` (served at `/manifest.webmanifest`, which `proxy.ts` lets through without a session, since browsers fetch it without one and an install has to work from the sign-in page), the icons in `public/` (`icon-192.png`, `icon-512.png`, and the full-bleed `icon-maskable-512.png` Android crops to its own shape), `app/apple-icon.png` for iOS, and the `appleWebApp` and theme color entries in `app/layout.tsx`. To redraw the icons after changing the logo:

```
magick -background none -density 900 public/logo.svg -resize 512x512 -strip public/icon-512.png
magick -background none -density 600 public/logo.svg -resize 192x192 -strip public/icon-192.png
```

The maskable and Apple icons use the same mark at 72% on a full `#141414` square.

## The phone frame

Under 600px the page takes the shape of a phone app. It is the same page and the same widgets; only the frame around them changes.

- A bar at the bottom with three places: Dashboard, Digest, Settings (`components/PhoneTabBar.tsx`). It is hidden while the layout is being edited, so nothing sits over the widget picker.
- The top is the current dashboard's name as a title. Tapping it opens the top bar's fields (the two text fields and the clock) in a panel under it; tapping again closes it.
- One dot per dashboard at the top right, the current one filled. Tapping the dots opens the dashboards list, with rows sized for a thumb: switch, rename, delete, new. Reordering by drag needs a mouse, so the grip is left out here.
- Swiping left or right moves to the next or previous dashboard. The neighbour follows the finger; letting go past a quarter of the width, or after a quick flick, commits, anything less springs back. The swipe is not taken from things that scroll sideways themselves (tab groups, tables, sliders, text fields) or while the overview or layout editing is open (`SWIPE_BLOCK` and the handlers in `app/page.tsx`).
- Settings is a full page with the bar still under it: sections become cards of rows, and a "This dashboard" section at the top holds "Edit the layout". While editing, the top right shows cancel and done in place of the dots. `/#settings` opens it from another page, which is how the Digest's bar gets there.

A window 600px or wider keeps the top bar as it was.

## The jump button

A floating round button with the oldenbyte mark, like iOS AssistiveTouch. It is shown on the visible dashboard, on phones only, and not while editing the layout or with a widget in full screen.

- Tap: open the overview (tap again to go back to where you were).
- Drag: move it. It settles on the nearer side edge and remembers the spot on this device (`localStorage`, key `oldenbyte-jump-pos`).
- Hold (about a quarter of a second without moving): every widget's name appears in a column beside the button. Slide up or down and the name level with your thumb is picked, so the name is beside the thumb, not under it (the gesture of a contacts index). The phone ticks once per name where it can vibrate. Let go to jump there; a tab group's members are listed under its first tab, and jumping to one selects that tab. Letting go without sliding, or after sliding far away sideways, cancels.

A jump scrolls the widget to the top and rings it for a moment.

Settings > Phone > Jump button turns it off (setting `mobile-jump`, on unless `"0"`).

## The overview

The desktop arrangement of the dashboard, live, scaled down to fit the phone: the same grid you see on a wide screen, with every widget still running, and a readable name on each tile. Tap a tile to zoom into it; you land on that widget in the stacked list.

How it works: the grid is laid out 1200px wide and 650px tall, the proportions it has on a computer's screen, and a CSS transform scales it to the phone's width, centered. It is a small picture of the dashboard as it was arranged: a place to pick the next widget from, not to read in. Widgets are never remounted, since each renders once into its own node and the layouts only adopt those nodes. The layout variant is forced by the overview state rather than by the measured width, so the switch and the transform land in the same paint and nothing flashes.

The overview fades in at very nearly its final size (it starts 6% larger), and a tap on a tile fades it out toward that tile, then the stacked list returns with that widget at the top. Two earlier versions are worth knowing about:

- It first filled the phone's height, which stretched a dashboard made for a wide screen into overly tall tiles.
- It first zoomed all the way out of the widget on screen and into the chosen tile. A browser draws a scaling layer at the largest size the animation reaches, so a phone had to draw the whole desktop grid at full size before moving: slow to start, not smooth, and with `will-change` left on at rest Android ran out of graphics memory and dropped pieces of the page (tiles cut off, the top bar gone). Staying near the final size keeps what is drawn small.

Rotating the phone, entering layout editing or switching dashboards closes the overview.

Touch taps do not move the keyboard target (the teal logo and ring are for a keyboard).

## Apps

A native app talks to the server through the versioned routes in [api-v1.md](./api-v1.md): it signs in as a device, reads the dashboards and widget data, and shows any widget it has not rebuilt natively through the single-widget page `/embed/<dashboard id>/<widget id>`. Signed-in apps are listed under Settings > Devices, where each can be signed out.
