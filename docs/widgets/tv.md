# TV Widget

Watches live IPTV channels, for example an [ErsatzTV](https://ersatztv.org/) playlist. Load an M3U channel list, pick a channel, and press play.

## Storage Keys

| Key | Value |
|---|---|
| `tv-widget-{id}` | JSON: `{ playlistUrl, channels: { name, url }[], channelUrl, channelName }` |

## Settings

Enter a playlist (`.m3u`) URL and press **Load**: the server parses it with `GET /api/tv?op=channels` and the first channel (or the previously picked one) is selected. A direct `.m3u8` stream URL also works without a channel list. The channel picker in the widget header switches channels without opening settings.

## Playback

The IPTV server usually serves plain http on the LAN while the dashboard is on https, so the browser cannot load the streams directly (mixed content). All traffic goes through `/api/tv` (see [api.md](../api.md#tv)):

- **HLS** (`.m3u8`): the playlist is fetched with `op=playlist`, which rewrites every nested playlist and segment URI back through the proxy. Safari plays it natively; other browsers use hls.js.
- **Anything else** is treated as a live MPEG-TS stream (ErsatzTV's default) and played with mpegts.js over MSE, streamed through `op=seg`.

Both players are loaded on demand. Playback stops when the widget scrolls out of view or its dashboard is hidden, since a hidden video would keep the server transcoding. Reaching a LAN or tailnet server needs an admin account; other accounts can only use public stream URLs.

Not digestable.

(component: `components/TvWidget.tsx`; proxy: `app/api/tv/route.ts`)
