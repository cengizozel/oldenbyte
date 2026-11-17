# App API (v1)

The API for apps: the phone app, and anything else that is not the website. The website keeps using the routes in [api.md](./api.md); those may change with any release. The routes here are a promise:

- Within version 1, routes and fields are only added, never renamed or removed. An app built against an older server keeps working against a newer one, and must ignore fields it does not know.
- Every answer carries the header `X-Oldenbyte-Api: 1`.
- A change that would break an app becomes `/api/v2`. Version 1 keeps answering until `api.min` (below) says otherwise.

Code: `lib/apiV1.ts`, `lib/devices.ts`, `app/api/v1/`.

## Signing in as a device

An app does not use the browser's cookie. It signs in once with the username and password and gets a token of its own, which it sends on every request:

```
Authorization: Bearer obd_...
```

- The token is 32 random bytes behind the prefix `obd_`. It is shown once, at sign-in; the server stores only its SHA-256, so a copy of the database cannot sign in as a device.
- It does not expire. It ends when the device is signed out (from the app, or from Settings > Devices on the website), when the account's password changes, or when the account is deleted.
- It works on every API route the account could use from the website, not only the v1 routes, with the same permissions (a regular account's token is refused on admin routes).
- It works on `/api/` only. Pages are for browsers; see [Showing a widget in a web view](#showing-a-widget-in-a-web-view).
- A request that presents a device token is judged on the token alone. A wrong or revoked token answers `401`, even if a valid cookie came along with it.
- An account holds at most 50 devices; signing in a 51st signs out the one unused the longest.

Errors are `{ "error": "..." }` with the usual status: `400` bad input, `401` not signed in, `403` not allowed (or `password_change_required`), `404`, `429` with `Retry-After`.

## Routes

### `GET /api/v1/server` (no sign-in)

The first thing an app asks after the user types an address: is this an oldenbyte server, and which API does it speak.

```json
{ "name": "oldenbyte", "version": "0.1.0", "api": { "version": 1, "min": 1 }, "ready": true, "registration": false }
```

- `api.version`: the newest app API this server speaks. `api.min`: the oldest it still answers. An app built for a version below `min` should tell the user to update the app; one built for a version above `version` should tell them to update the server.
- `ready`: false on a server nobody has set up yet. The first account is made on the website.
- `registration`: whether new accounts can be made with an invite code.

The answer of `GET /api/v1/server` also carries `features`, a list of things this server's pages do for an app that shows them in a web view. `app-settings`: inside an app's web view (where `window.ReactNativeWebView` exists) the dashboard's settings show "App settings" in place of "Log out", which posts `{"type":"oldenbyte:app-settings"}` to the app. An app that shows the dashboard on a server without this feature has to offer its own way to its settings.

### `POST /api/v1/auth/login` (no sign-in)

Body `{ "username", "password", "device" }`. `device` is the name shown in Settings > Devices ("Pixel 9"); up to 60 characters, optional. The same check and rate limits as the website's sign-in.

```json
{
  "token": "obd_...",
  "device": { "id": "...", "name": "Pixel 9" },
  "user": { "id": "...", "username": "sam", "role": "user", "mustChangePassword": false }
}
```

Keep the token in the platform's secure storage (Keychain, Keystore). `401` for a wrong username or password.

### `POST /api/v1/auth/logout`

Signs this device out. The token stops working at once, with any web sessions it opened.

### `GET /api/v1/me`

```json
{ "id": "...", "username": "sam", "role": "user", "mustChangePassword": false, "device": "<device id>" }
```

Answers even when a password change is due, so the app can say why nothing else works. When `mustChangePassword` is true, every other route answers `403 password_change_required` until `POST /api/account/password` (`{ currentPassword, newPassword }`) succeeds. Changing the password signs out every browser and device; a device that makes the change gets its replacement in the answer (`{ ok, token, device }`) and must store the new token.

### `GET /api/v1/devices`

The apps signed in to the account, most recently used first.

```json
{ "devices": [{ "id": "...", "name": "Pixel 9", "createdAt": "2026-11-17T09:00:00.000Z", "lastUsedAt": "2026-11-17T09:41:00.000Z", "current": true }] }
```

`lastUsedAt` is updated at most once a minute.

### `DELETE /api/v1/devices/<id>`

Signs that device out (a lost phone). Only the account's own devices; any other id answers `404`.

### `GET /api/v1/dashboards`

Every dashboard with its widgets, for the app's navigation.

```json
{
  "dashboards": [{
    "id": "default", "name": "Home", "active": true,
    "widgets": [
      { "id": "todo-1", "type": "todo", "title": "Todo", "color": "amber", "group": null, "x": 0, "y": 0, "w": 1, "h": 2 },
      { "id": "notes-2", "type": "notepad", "title": "Notes", "color": "neutral", "group": "todo-1", "x": 0, "y": 0, "w": 1, "h": 2 }
    ]
  }]
}
```

- Widgets come in reading order: top to bottom, then left to right, on the 4-column grid (`x`, `y`, `w`, `h` are grid units).
- `group`: for a tab of a tab group, the id of the group's first tab (which comes just before it); `null` otherwise.
- `type` is a widget type from `lib/widgets.ts`. New types appear over time; show a type the app has not built natively through the web view below.

### `GET`, `POST`, `DELETE /api/v1/settings`

The key and value store every widget keeps its data in, the same one the website uses: `GET ?key=`, `POST { key, value, version? }`, `DELETE ?key=`. The `version` compare-and-set is described under Settings in [api.md](./api.md); the keys each widget uses are in [storage.md](./storage.md) and the widget's page in [widgets/](./widgets/). What the app writes shows on the website and the other way round.

## Showing a widget in a web view

`/embed/<dashboard id>/<widget id>` is a page with one widget filling the window: no top bar, no grid, nothing else. It is the same component the dashboard renders, on the same data. An app uses it for any widget it has not rebuilt natively.

A web view can attach a header to the first request it makes, but not to the requests the page then makes itself, so the page needs a cookie. The app trades its token for one:

```
GET /api/v1/auth/web?next=/embed/default/todo-1
Authorization: Bearer obd_...
```

The answer is a `303` to `next` with a session cookie set. Load that URL in the web view with the header on the first request only.

- Only a device token is accepted here; a browser session cannot mint one.
- `next` must be a path on this server. Anything else lands on `/`.
- The session is tied to the device: signing the device out ends it. It lasts 30 days like any session, so an app should go through this route again when a page answers with a redirect to `/login`.
- A widget id that is no longer on that dashboard shows a short message instead of a widget.
