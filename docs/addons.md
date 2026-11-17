# Add-ons

An add-on plugs a service into a built-in widget. It is one small JSON file with no code: it says which requests to make to the service and how to read the answers. The dashboard server makes the requests; the widget does the rest.

Add-ons exist so that support for one more self-hosted service does not need a change to oldenbyte itself. They come from two places:

- `addons/` in this repository: shipped with oldenbyte, available to every account. Add one with a pull request.
- Your own: in the widget's settings, the upload button next to the list of add-ons takes a `.json` file. It is kept with your account (up to 20) and can be removed there.

A widget offers a slot; an add-on names the slot it fills.

| Slot | Widget | What an add-on provides |
|---|---|---|
| `youtube.archive` | YouTube | A place the user's videos also live (an archive, another front end): whether it has a video, and where the video opens |

More slots (Reader sources, Calendar providers, Chat data sources) will follow the same shape.

## What an add-on cannot do

By construction, not by review:

- It cannot contact any host except the one the user types. A request is a path on the user's address, never a full URL.
- It cannot send the user's values (a token, say) anywhere else: a link must start at the user's address too.
- It cannot run code or inject markup. The icon is only ever painted as a CSS mask.
- It reaches the home network only for admin accounts, like every other integration; for other accounts the address must be a public one.

So an add-on from a stranger can at worst talk nonsense to the service you pointed it at.

## Example: `youtube.archive`

`addons/tubearchivist.json`, shortened:

```json
{
  "id": "tubearchivist",
  "slot": "youtube.archive",
  "name": "TubeArchivist",
  "description": "Your own YouTube archive. Videos it has downloaded can open there instead of on YouTube.",
  "icon": "<svg ...>...</svg>",
  "config": [
    { "key": "url", "label": "Address", "type": "url", "placeholder": "http://server:8000" },
    { "key": "serverUrl", "label": "Server address", "type": "url", "optional": true },
    { "key": "token", "label": "API token", "type": "secret" }
  ],
  "ping": {
    "path": "/api/ping/",
    "headers": { "Authorization": "Token {config.token}" },
    "ok": { "path": "$.response", "equals": "pong" },
    "version": "$.version"
  },
  "has": {
    "path": "/api/video/{id}/",
    "headers": { "Authorization": "Token {config.token}" },
    "found": [200],
    "missing": [404]
  },
  "open": "{config.url}/video/{id}"
}
```

`addons/invidious.json` is the other kind: a front end that has every video, so it has no `has` and no token.

## Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | 2 to 40 characters of `a-z`, `0-9`, `-`. An upload cannot reuse the id of a shipped add-on |
| `slot` | yes | `youtube.archive` |
| `name` | yes | Max 30 characters. Shown in settings and in badge tooltips |
| `description` | yes | Max 200 characters |
| `icon` | no | An SVG drawn in one color, max 8000 characters. Used as the badge on videos; without it a generic archive icon is shown |
| `config` | yes | 1 to 8 fields the user fills in, see below |
| `ping` | no | The connection test behind the Test button |
| `has` | no | "Is this video there?", asked per video. Left out: the service has every video |
| `open` | yes | Where a video opens. Must start with `{config.url}/` and contain `{id}` |

### `config`

Each field: `key` (letters and digits, starting with a letter), `label`, `type` (`url`, `text` or `secret`), and optionally `placeholder`, `hint`, `optional: true`.

Two keys have a meaning:

- `url` (required, type `url`): the service's address as the browser opens it.
- `serverUrl` (optional, type `url`): when the user fills it in, the server uses this address for its requests instead. For a service the server reaches differently than the browser does, such as a tailscale HTTPS name that does not resolve inside the server's container.

### Requests (`ping`, `has`)

- `path`: appended to the service's address. Must start with one `/`.
- `headers`: up to 10. `Host`, `Cookie` and the connection headers are refused.

Placeholders: `{config.<key>}` anywhere, and `{id}` (the video id) in `has.path` and `open`. Values are URL-escaped in paths and links.

`ping.ok` is `{ "path": "$.field", "equals": "text" }`: a value in the JSON answer that must match, so that some other server at that address is not taken for the service. `ping.version` is a path to the version shown after a successful test. Paths use the widget bank's syntax ([widget-bank.md](./widget-bank.md#path-expressions)).

`has.found` and `has.missing` list the HTTP statuses that mean yes and no; `[200]` and `[404]` when left out. Any other status keeps the last known answer.

## API

### `GET /api/addons`
`{ "addons": [{ ...addon, "source": "built-in" | "yours" }], "errors": { "<file>": ["..."] } }`. `errors` lists invalid files in `addons/` and is only filled in for admins.

### `POST /api/addons`
`{ "addon": { ... } }` adds or replaces one of your own. `400` with `errors` when it is not valid, `409` when the id belongs to a shipped add-on.

### `DELETE /api/addons?id=<id>`
Removes one of your own.

### `POST /api/addons/run`
Makes an add-on's requests. POST so the user's values ride in the body, never in a URL.

- `{ id, op: "ping", values }` returns `{ "ok": true, "version": "..." }`.
- `{ id, op: "has", values, ids, force? }` returns `{ "has": ["<id>", ...] }`, the subset of up to 100 `ids` the service has. Answers are remembered per add-on and values: "has it" for an hour, "does not" for 2 minutes; `force` skips that memory.

Errors return `503`.

Code: `lib/addons.ts` (format and validation, shared with the browser), `lib/addonsServer.ts`, `app/api/addons/`. Your own add-ons are stored under the settings key `addons`.
