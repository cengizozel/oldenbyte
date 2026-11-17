# Custom widgets

A custom widget is one HTML file written by anyone. oldenbyte draws the card around it (header, settings face, colors, full screen, tabs) and runs the file in a sandbox as the card's body. It is the third way to extend oldenbyte without changing it:

| | What it is | Code? |
|---|---|---|
| [Widget files](./widget-bank.md) | A JSON file: one URL to fetch and how to lay out the answer | No |
| [Add-ons](./addons.md) | A JSON file that plugs a service into a built-in widget | No |
| Custom widgets | An HTML file with its own markup, styles and scripts | Yes, sandboxed |

This document (the format, the `ob` API and the examples in it) is MIT licensed, like the [community widgets repository](https://github.com/cengizozel/oldenbyte-widgets). A widget talks to oldenbyte only through the messages described here, so it is a separate work from oldenbyte and may carry any license.

## Where they come from

- **Your own**: in edit mode, the widget picker has "Upload a widget file". The file is kept with your account as `yours/<id>`. Uploading the same id again replaces it.
- **The community catalog**: the picker's Community tab lists the widgets in the community repository. Install downloads the file to your server as `community/<id>`. When the catalog has a newer version the entry says Update.

Installed widgets appear in the picker under Custom and are added to a dashboard like any other. They are managed in Settings, Custom widgets: switch an elevated widget on or off, or remove a file. Removing a file keeps the data of widgets already placed; they show a note until the file is installed again.

The server reads the catalog, never the browser, so opening the picker tells no outside site anything about you. `WIDGET_CATALOG_URL` points a server at another catalog; `off` turns the catalog off.

## Two tiers

| Tier | What the widget can do | What it takes |
|---|---|---|
| Standard | Draw its body, keep its own data, read its own settings, follow the theme, set its header count, publish a summary of itself, open a link | One notice when it is added |
| Elevated | Also the powers its manifest lists | The account's switches, then the widget's own switch, each behind a warning that names the powers |

The powers:

| Power | What it allows | Limits |
|---|---|---|
| `network` | Requests to any address, made by the oldenbyte server | The home network only for admin accounts; other accounts reach public addresses only. Answers up to 2 MB; media streams through tickets |
| `widgets` | Reading what the user's other widgets show, as text | Read only, through the same reader the Chat widget uses |
| `files` | Listing and reading the file library (the Reader's folder) | Read only, PDF and EPUB |

Elevated widgets are off by default, like installing from unknown sources on a phone:

1. Settings, Custom widgets, "Allow elevated widgets" is the master switch, off for every new account.
2. Under it each power has its own switch.
3. An elevated widget added while its powers are not all switched on is installed switched off.
4. Switching the widget on shows what it asks for, in words.

Turning a power off later stops every widget that needs it at once. The server checks all of this on every call; the dashboard's own checks are only there to explain.

Never, in any tier: the sign-in or session, changing another widget, another user's data, or acting with another widget's saved credentials.

## The file

```html
<script type="application/json" id="oldenbyte-widget">
{
  "format": 1,
  "id": "countdown",
  "name": "Countdown",
  "description": "Days, hours and minutes until a date you choose.",
  "version": "1.0.0",
  "author": "Your name",
  "color": "amber",
  "category": "time",
  "defaultSize": { "w": 1, "h": 2 },
  "digest": true,
  "settings": [
    { "key": "label", "label": "What for", "type": "text", "placeholder": "e.g. Trip to Lisbon" },
    { "key": "date", "label": "Date", "type": "text", "hint": "Year-month-day." }
  ]
}
</script>

<style> .big { font-size: 44px; font-weight: 600; } </style>
<div class="big" id="days"></div>

<script>
  const days = Math.ceil((new Date(ob.settings.date) - Date.now()) / 86400000);
  document.getElementById("days").textContent = days;
</script>
```

Everything the widget needs is inside the file, at most 512 KB. Outside scripts, stylesheets, fonts and images are blocked.

### Manifest

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | `1` |
| `id` | yes | 2 to 40 characters of `a-z`, `0-9`, `-` |
| `name` | yes | Shown in the picker and as the default title (max 40) |
| `description` | yes | One line (max 160) |
| `version` | yes | `1.0.0` style; a higher one is an update |
| `author`, `homepage`, `license` | no | Shown in the widget's settings and the catalog; `homepage` must be https |
| `color` | no | `amber`, `sky`, `neutral`, `rose`, `teal`, `orange` |
| `category` | no | A picker category id, used by the gallery |
| `defaultSize` | no | Grid cells: `w` 1 to 4, `h` 1 to 8 |
| `icon` | no | An SVG (max 8000 characters), painted as a mask in the header |
| `settings` | no | Up to 20 fields drawn on the settings face |
| `powers` | no | `network`, `widgets`, `files`. Any power makes the widget elevated |
| `digest` | no | `true` when the widget publishes a summary (`ob.summary`) |

A settings field is `{ key, label, type, default?, placeholder?, hint?, options? }`. Types: `text`, `secret` (masked), `number`, `toggle`, `textarea`, and `select` with `options: [{ value, label }]`.

### Look

The frame starts with the card's look: a transparent background, the dashboard's font at 14px, and these CSS variables, which follow the widget's color and the theme live:

| Variable | Is |
|---|---|
| `--text` | The card's text color |
| `--muted` | Its quieter text color |
| `--bg` | The card's background (for knockouts) |
| `--border` | The card's border color (for hairlines) |

`<html>` has the class `dark` in dark mode. Keep text at 14px or larger and avoid all caps, like the rest of oldenbyte.

## The `ob` object

`ob` exists before the widget's scripts run. Calls return promises; a refused call rejects with a message.

| | |
|---|---|
| `ob.settings` | The settings' values, by key |
| `ob.instance` | `{ id, title }` of this placed widget |
| `ob.widget` | `{ id, name, version }` from the manifest |
| `ob.theme` | `{ dark, text, muted, bg, border }` |
| `ob.visible` | `false` while the dashboard or browser tab is hidden |
| `ob.powers` | The powers the manifest lists |
| `ob.on(event, fn)` | `settings`, `theme`, `visible`, `title`. Returns a function that stops listening |
| `ob.storage.get(key)`, `.set(key, value)`, `.remove(key)`, `.keys()` | This instance's own data. Any JSON value up to 256 KB, up to 100 keys; keys are letters, digits, `.`, `-`, `_` |
| `ob.badge(text)` | A short count or word next to the title (max 12 characters); empty clears it |
| `ob.summary(text)` | What the widget shows right now, in plain text (max 4000 characters). The Chat widget and other widgets with the `widgets` power can read it, and with `"digest": true` in the manifest it becomes the widget's section in the digest |
| `ob.open(url)` | Opens an http or https link in a new tab. Call it from a click |

When settings are saved the widget restarts with the new values, unless it listens with `ob.on("settings", fn)`, in which case it gets them live. A music player listens, so saving settings does not stop the music.

Widgets stay loaded while hidden (another tab of a tab group, another dashboard), so audio keeps playing. Pause your own polling when `ob.visible` is false.

With the `network` power:

| | |
|---|---|
| `ob.net.fetch(url, { method, headers, body, as })` | Resolves to `{ ok, status, headers, body, error? }`. `body` is text, or base64 with `as: "base64"`. A failed connection resolves with `ok: false, status: 0` |
| `ob.net.mediaUrl(url, { headers })` | Resolves to an address for `<audio>`, `<video>` or `<img>`, valid for 12 hours, with range requests, so media can seek |

With the `widgets` power:

| | |
|---|---|
| `ob.widgets.list()` | `[{ id, type, title, dashboard }]` |
| `ob.widgets.read(id)` | That widget's content as text |

With the `files` power:

| | |
|---|---|
| `ob.files.list(path)` | `{ dirs, files: [{ name, size }] }` of a library folder (`""` is the top) |
| `ob.files.url(path)` | An address for the file's bytes, valid for 12 hours; `fetch` it for the content |

## The sandbox

How a widget is kept in, so the tiers mean something:

- The file runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. It has an origin of its own: no cookies, no session, no access to the dashboard's page or storage.
- A content security policy blocks every request from the frame: `default-src 'none'`, inline scripts and styles only, no forms, no frames. The one exception is oldenbyte's ticket address (below).
- A frame may always navigate itself, which would be a way to send data out in an address. So the widget sits in a frame inside a frame: the outer one carries the policy (`frame-src 'none'`) and passes messages; the widget's own frame answers to that policy and cannot leave. No popups: links go through `ob.open`.
- The dashboard only listens to its own frame, and treats every message as a request it may refuse. Storage keys are forced into the instance's own namespace.
- Elevated calls go to `/api/custom-widgets/call`, where the server checks that the widget is installed for this user, switched on, lists the power, and that the account's switch for it is on.
- Media and library files load through tickets: a signed, expiring note of exactly one address or file for one user and widget. The ticket route answers only with media types or as a download, sandboxed, so nothing it serves can run as a page of the dashboard.

What is left, stated plainly:

- `ob.open` opens the address the widget gives it, and an address can carry data. It needs a click (the browser blocks it otherwise), and you see the tab open.
- An elevated widget with `network` can send anything it can read to anywhere. That is what the power means, and what the warning says.
- The sandbox depends on the browser enforcing iframe sandboxing and content security policy. It was tested in Chromium and Firefox against a widget that tries eleven ways out.
- Listed in the catalog is not reviewed. `reviewed` means another person read that exact file.

## Storage

| Where | What |
|---|---|
| `data/widgets/<user id>/<yours\|community>/<id>.html` | The widget files (`WIDGETS_DIR` moves the folder). They count toward the account's [storage quota](./storage.md) |
| Setting `custom-widgets` | Which elevated widgets are switched on, and install times |
| Setting `elevated-widgets` | The account's switches: `{ allow, network, widgets, files }` |
| Setting `ext-widget-<instance>` | A placed widget's settings values and the list of its storage keys |
| Setting `ext-data-<instance>:<key>` | One storage key of a placed widget |
| Setting `ext-summary-<instance>` | Its published summary |

A placed widget is `{ type: "ext", ext: "<yours|community>/<id>" }` in the dashboard's instances. Its keys are cleaned up with the rest of a removed widget's data.

## API

All behind the session, except the ticket route.

| Route | |
|---|---|
| `GET /api/custom-widgets` | `{ widgets, elevated }`: the installed files and the account's switches |
| `POST /api/custom-widgets` `{ html }` | Adds or replaces one of your own. `400` with the reasons when the file is not a valid widget |
| `PATCH /api/custom-widgets` `{ ext, enabled }` | Switches an elevated widget on or off. `403` while the account's switches do not cover its powers |
| `DELETE /api/custom-widgets?ext=` | Removes a file |
| `GET /api/custom-widgets/source?ext=` | The file, as plain text |
| `POST /api/custom-widgets/call` `{ ext, op, args }` | An elevated call: `net.fetch`, `net.media`, `widgets.list`, `widgets.read`, `files.list`, `files.url`. Limited to 600 a minute per account |
| `GET /api/custom-widgets/media?t=` | What a ticket names. No session; the ticket is the permission |
| `GET /api/custom-widgets/catalog` | The community catalog (`?refresh=1` reloads it) |
| `POST /api/custom-widgets/catalog` `{ id }` | Installs that widget. The download must match the catalog's hash |

Code: `lib/customWidgets.ts` (format and sandbox), `lib/customWidgetsServer.ts` (files, switches, tickets), `lib/widgetCatalog.ts`, `components/CustomWidget.tsx` (the card and the message bridge), `components/CustomWidgetPicker.tsx`, `components/CustomWidgetsSettings.tsx`.
