# oldenbyte without a server

The phone app shows the same oldenbyte in every mode; only where the data lives differs. With the data on the phone there is no server, so the interface has to run without one. This page says how.

## The idea

The interface is built as plain files, and the server's own route code is packed into those files and run in the page. A widget still asks for `/api/weather` or `/api/settings`; the request never leaves the page. It is answered by the same route file a server would run, on top of stand-ins for the few things only a server has. So a device answers as a server does, because it is the same code, and a new route works on a device without being written twice.

## Building it

`node tools/app-bundle/build.mjs [out dir]` (default `app-bundle-out/`). It works on a copy of the source:

- Next.js is set to `output: "export"` with `NEXT_PUBLIC_OB_APP=1` (`lib/onDevice.ts` reads it).
- `app/api` is copied to `deviceApi/`, outside `app/`, without the routes that only make sense with a server (signing in and accounts, other devices, the machine the server runs on). A table of the rest is written to `lib/appHost/routes.ts`: a pattern per route file and a lazy import, so a route's code loads when it is first asked for.
- Five helpers are swapped for a device's version from `lib/appHost/device/`: `prisma`, `session`, `ssrf`, `requestUser`, `password`.
- Node's own modules are pointed at `lib/appHost/device/node/` for the browser build only: `fs`, `fs/promises`, `path`, `crypto`, `stream`, `busboy`, and a file of things a device has no use for.
- The folders the server reads its shipped files from (`widget-bank`, `addons`) are copied to `/_device/` with a list of what is there.

## What stands in for the server

| On a server | On a device |
|---|---|
| The database (`lib/prisma.ts`) | The same calls on the device's store. `setting` is the user's data; `cache` and `appConfig` are kept under `device:` and stay on the device. There is one user. Versions are the store's own counter, so "changed in another tab" works as on a server. |
| The session (`lib/session.ts`) | Every request is the owner's. |
| The guard on outgoing requests (`lib/ssrf.ts`, `lib/requestUser.ts`) | Nothing to guard: a device reaches only what its owner asked for. |
| Files (`fs`, `fs/promises`) | A written file is kept in the store under `device:file:`, as base64. A file that ships with oldenbyte is read from `/_device/`. |
| Uploads (`busboy`, `stream`, `fs.createWriteStream`) | The upload is already whole in the page; the browser's form parser reads it and the route's code is told the same story (a field, a file, the end). Files over 20 MB are refused. |
| `crypto` | Random bytes and ids from the browser, and SHA-256 written out, since the code asks for it without waiting. |

## The page's side

`components/AppHost.tsx`, in the bundle only:

- A first script catches every request to `/api/...` on the page's own origin, from `fetch` and from `XMLHttpRequest` (the video player and the book reader use the latter), and hands it to the host.
- The host is `lib/appHost/localApi.ts`: it finds the route in the table and calls its handler with a `NextRequest`. It answers `/api/me`, `/api/auth/state` and `/api/v1/devices` itself, and a route that is not packed answers 501 with "This needs an oldenbyte server.", which the widget shows as its own error.
- Requests to other sites go out through the app where there is one, so the browser's cross-origin rule does not stand between a route and the feed it fetches.

## The bridge

`lib/appHost/bridge.ts`. The page needs two things from wherever it runs: a store of keys and values, and a way out to the internet.

- In the phone app both are messages to the native side: `{ ob: "kv", id, op: "get" | "set" | "remove" | "list", key, value, expect }` and `{ ob: "fetch", id, url, method, headers, body | bodyBase64 }`, answered with `window.__obReply(id, result, error)`. A value comes back with its version and when it changed; `set` with `expect` writes only if the key is still at that version.
- In a plain browser, used to try the bundle, the store is the browser's storage and the internet is the browser's `fetch`.

Keys that start with `device:` belong to this device alone: the app never sends them to the user's other devices.

## What a device does not do

- The Docker and Server widgets show the machine a server runs on. A device does not offer them, and one that arrives in a dashboard made elsewhere says it needs a server.
- Accounts, the admin pages and signing in do not exist: the settings show "This device" instead.
- Media for custom widgets (`/api/custom-widgets/media`) is not packed yet.
- A long answer from a model arrives whole, not word by word, because a request made by the app comes back in one piece.

## Trying it

Serve the output with any static file server and open it in a browser. To let the routes fetch other sites from a plain browser, start Chromium with `--disable-web-security`. The dashboard seeds itself on first run, as on a new server.
