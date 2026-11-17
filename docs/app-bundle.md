# The interface as plain files

The phone app is meant to show the same oldenbyte as a server does, in every mode; only where the data lives differs. For that the interface has to run with no server behind it. This is the first stage of that work.

## What exists

`node tools/app-bundle/build.mjs [out dir]` builds the interface as static files (default `app-bundle-out/`). It builds from a copy of the source without what only a server has (`app/api`, the sign-in and admin pages, `proxy.ts`), with Next.js set to `output: "export"` and `NEXT_PUBLIC_OB_APP=1`. The components are the same code as on a server.

In that build the layout adds two things (`components/AppHost.tsx`):

- a first script that catches every request the page makes to `/api/...` on its own origin, so the widgets need no change: they keep calling the API as on a server;
- the host, which answers those requests on the device.

The answers come from `lib/appHost/localApi.ts`, which gives each route the same shape as the server's. Storage goes through a bridge (`lib/appHost/bridge.ts`): messages to the native side in the phone app (`{ ob: "kv", id, op, key, value }`, answered with `window.__obReply(id, result, error)`), the browser's own storage in a plain browser.

## Routes answered on the device

| Route | On the device |
|---|---|
| `/api/settings` (GET, POST with the version check, DELETE), `/export`, `/import`, `/orphans` | The device's own store |
| `/api/me`, `/api/auth/state` | One person, admin of their own device |
| `/api/widget-bank`, `/api/addons`, `/api/custom-widgets`, `/api/custom-widgets/catalog`, `/api/v1/devices` | Empty lists for now |
| Everything else | `501` with "This needs an oldenbyte server for now.", which the widget shows as its own error |

So today the widgets that only keep their own data work fully (Notepad, Todo, Text, Tracker, Rhythm, Upkeep, Deficit, Bookmarks, Clock, Typing, Search, Schedule) and the ones that fetch say they need a server. Nothing shows made-up data.

## What was tried

Served by a plain static file server and opened in a browser: the dashboard loads and seeds itself, makes no request to any `/api` over the network, keeps a written value across a reload, and a feed route answers 501.

## Not done yet

- The phone app does not load this bundle yet. It needs a way to serve the files to its web view and the native side of the bridge, on top of the on-device database and sync it already has.
- A second host that sends the same requests to a server with the device's token, so server mode uses the bundled interface too.
- The fetching routes (feeds, weather, calendars and the rest) on the device: the same parsing code, with the outgoing request made by the app.
- Files (the Reader's library, uploads), custom widgets and widget files on a device.
