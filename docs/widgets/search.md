# Search Widget

A search box for the engine you choose. Type and press Enter; the results open in a new tab (or this one). Something that already is an address (`https://...`) opens as it is.

## Storage Keys

| Key | Value |
|---|---|
| `search-widget-{id}` | JSON: `{ engine, custom, customName, newTab }` |

- `engine` - `duckduckgo` (default), `google`, `bing`, `brave`, `startpage`, `kagi`, `wikipedia`, or `custom`
- `custom` - for `custom`: an address starting with http and containing `%s` where the query goes, for example your own SearXNG (`https://search.example.com/search?q=%s`)
- `customName` - shown in the box's placeholder ("Search SearXNG")
- `newTab` - open results in a new tab (default) or this one

## Behaviour

- The query is URL-encoded into the engine's address. Nothing is sent to the dashboard's server: the browser opens the engine directly.
- From the keyboard, the widget's number puts the cursor in the box.

Not digestable.

(component: `components/SearchWidget.tsx`)
