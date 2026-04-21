# YouTube Widget

Displays recent videos from one or more YouTube channels. Channels are added by handle (`@name`), URL, or raw channel ID.

## Storage Keys

| Key | Value |
|---|---|
| `youtube-widget-{id}` | JSON: `{ channels: YoutubeChannel[] }` |
| `youtube-widget-{id}-{YYYY-MM-DD}-{channelId:limit,...}` | Daily cache of fetched videos |

`YoutubeChannel` is `{ channelId: string; name: string; limit: number }`.

The cache key encodes the date and the full channel+limit list so any configuration change bypasses the cache.

## Channel Resolution

When the user types a handle or URL, `GET /api/youtube?channel={input}&limit=1` is called. The server:

1. If the input already matches `UC[22 chars]`, uses it directly as the channel ID
2. Otherwise builds a URL (`https://www.youtube.com/@handle` or the input URL as-is) and fetches the page
3. Extracts the `UC…` channel ID from the canonical link, `externalId` JSON field, or any `/channel/UC…` occurrence in the HTML
4. Extracts the channel name from the page `<title>`

The resolved `channelId` and `name` are stored in the config so the resolution step only runs once per channel.

## Video Fetching

`GET /api/youtube?channelId={id}&limit={n}` fetches videos using a two-step strategy:

**Primary — RSS:** `https://www.youtube.com/feeds/videos.xml?channel_id={id}`  
Parsed with regex: finds `<entry>` blocks and extracts `<title>`, `<link href>`, and `<published>`.

**Fallback — Channel page scrape:** If the RSS request returns a non-2xx status (YouTube sometimes returns 404), the route fetches `https://www.youtube.com/channel/{id}/videos` with a browser `User-Agent`, extracts the `ytInitialData` JSON blob from the page `<script>` tags, and navigates the nested structure to find `videoRenderer` objects. Each renderer provides a `videoId`, `title.runs[0].text`, and `publishedTimeText.simpleText` (relative string like "2 days ago"). Relative times are converted to approximate ISO timestamps via `relToIso()`.

Videos from multiple channels are interleaved round-robin.

## Config Migration

On load, configs without per-channel `limit` (old format used a single top-level `limit`) are migrated by applying the old top-level value to every channel entry.

## Display

Each video entry shows a colored channel badge, a relative publish time (`timeAgo()`), and the video title as a link. `timeAgo()` formats the diff as `Xm ago`, `Xh ago`, `Xd ago`, `Xw ago`, `Xmo ago`, or `Xy ago`.

Channel colors cycle through a fixed palette of six colors (rose, sky, violet, teal, amber, emerald), consistent between settings and list views.

## Scroll Fades

Top and bottom gradient fades are toggled via `ResizeObserver` and scroll events, matching the pattern used by other list widgets.
