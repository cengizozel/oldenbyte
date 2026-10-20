# YouTube Widget

Displays recent videos from one or more YouTube channels. Channels are added by handle (`@name`), URL, or raw channel ID. Clicking a video opens an inline detail view with its description; archived videos can open on your own [TubeArchivist](https://www.tubearchivist.com/) server instead of YouTube.

## Storage Keys

| Key | Value |
|---|---|
| `youtube-widget-{id}` | JSON: `{ channels: YoutubeChannel[]; view: "list" \| "thumbs" \| "gallery" }` |
| `youtube-widget-{id}-{YYYY-MM-DD}-{hash}` | Daily cache of the combined video list |
| `youtube-tubearchivist` | JSON: `{ url, token, open: "youtube" \| "ta" }`, one TubeArchivist connection shared by every YouTube widget |

`YoutubeChannel` is `{ channelId: string; name: string; limit: number; filterMembers?: boolean; includeShorts?: boolean }`.

The cache key ends in a hash of every channel's `channelId:limit:filterMembers:includeShorts`, so any configuration change misses the cache. The signature is hashed (two 32-bit FNV-1a passes) because the settings API caps keys at 256 characters and the raw list of channel IDs outgrows that past a handful of channels. On load the widget paints the day cache (if any) and then always refetches. The refresh button refetches with `refresh=1`.

## Channel Resolution

When the user types a handle or URL, `GET /api/youtube?channel={input}&limit=1` is called. The server:

1. If the input already matches `UC[22 chars]`, uses it directly as the channel ID
2. Otherwise builds a URL (`https://www.youtube.com/@handle`, or the input URL, which must be on a YouTube host) and fetches the page
3. Extracts the `UC…` channel ID from the canonical link, `externalId` JSON field, or any `/channel/UC…` occurrence in the HTML
4. Extracts the channel name from the page `<title>`

The resolved `channelId` and `name` are stored in the config so the resolution step only runs once per channel. New channels go to the top of the list with a limit of 5.

## Video Fetching

`GET /api/youtube?channelId={id}&limit={n}` (plus `includeShorts=true` and `filterMembers=true` per channel) fetches each channel's videos. See [api.md](../api.md#youtube) for the full strategy:

- **Shorts filtering:** by default the server reads the channel's `UULF…` playlist feed (`/feeds/videos.xml?playlist_id=UULF…`, the uploads without Shorts) instead of the full channel feed. Because that playlist occasionally carries a Short anyway, each video is also checked against `https://www.youtube.com/shorts/<id>`: a real Short answers directly, a regular video redirects to `/watch`. The **include Shorts** checkbox switches to the full channel feed.
- **Members-only filtering:** the **filter members-only** checkbox makes the server scrape the channel's `/videos` page (`ytInitialData`), the only place members-only badges appear, and borrow exact publish times from the RSS feed.
- **Fallback:** if the feed fails (after one retry), the server scrapes the channel page instead. Relative times there ("2 days ago") are converted to approximate timestamps.

Results go through the server feed cache, so repeat loads within the admin TTL do not hit YouTube.

Videos from multiple channels are combined and sorted newest first. A video with no date (a live stream or premiere) sorts to the top.

## Video Detail

Clicking a title slides in a detail panel (thumbnail, author, length, view count, description) from `GET /api/youtube?video={link}`, which reads the video's watch page server-side.

## TubeArchivist

The settings card has an optional TubeArchivist section: server URL and API token, a **Test** button (`op: "ping"`), and an **Open on** choice of YouTube or TubeArchivist. The connection is saved once under `youtube-tubearchivist` and used by every YouTube widget; a connection saved on a single widget by an older version seeds the shared one.

With **Open on: TubeArchivist**, the widget sends the IDs of the shown videos to `POST /api/tubearchivist` (`op: "check"`). Videos found in the archive get a small `TA` badge and link to `{url}/video/{id}`; the rest still open on YouTube. The server remembers answers briefly, and the refresh button skips that memory. The token travels in the request body, never in a URL.

## Config Migration

On load, configs without per-channel `limit` (old format used a single top-level `limit`) are migrated by applying the old top-level value to every channel entry.

## Display

Three views, picked in settings:

- **List** - channel badge, relative time, and title
- **Thumbnails** - the same rows with a video thumbnail
- **Gallery** - a grid of thumbnail cards

Thumbnails come straight from `i.ytimg.com` by video ID, with no extra fetch. Each video shows a colored channel badge, a relative publish time (`timeAgo()`), and a `new` badge for uploads under 24 hours old. Channel colors come from `tagColor()` in `lib/colors.ts` (a hash of the channel name), consistent between settings and list views.

## Scroll Fades

Top and bottom gradient fades are toggled via `ResizeObserver` and scroll events, matching the pattern used by other list widgets.

## Filtering by channel

Clicking a channel name shows only that channel's videos from the feed; clicking it again, the chip's x in the header, or Escape shows everything again (`lib/useFeedFilter.ts`).
