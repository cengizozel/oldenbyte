# Anytype bridge

Lets the dashboard's chat assistant WRITE to Anytype with full block fidelity
(headers, bullets, checkboxes, code), and read the structural style of a space.

Why it exists: Anytype's full gRPC API only listens on a loopback port next to
the desktop app, so the dashboard server (local dev, or Docker on the home
server) cannot reach it directly. This bridge runs on the machine with the
Anytype app and forwards a small, fixed set of operations over HTTP. Reads for
chat search/lookup still use Anytype's regular local HTTP API; the bridge only
adds what that API cannot do.

## Setup (on the machine running the Anytype desktop app)

```bash
cd tools/anytype-bridge
./setup.sh          # venv (in ~/.local/share/oldenbyte) + anytype-grpc
~/.local/share/oldenbyte/anytype-bridge-venv/bin/python -m anytype_grpc.auth
                    # mint ANYTYPE_TOKEN (asks for your recovery phrase,
                    # hidden input, never written to disk)
cp env.example .env # fill in ANYTYPE_TOKEN, BRIDGE_TOKEN
./run.sh
```

To reach it from the prod dashboard, set `BRIDGE_HOST` to this machine's
tailscale IP. To start it with your session, install the systemd user unit
(instructions inside `anytype-bridge.service`).

In the dashboard: Chat widget settings -> Data sources -> Anytype -> fill in
the bridge URL (`http://<host>:31010`) and the same `BRIDGE_TOKEN`. That
unlocks the "create note" tools; without a bridge, Anytype stays read-only.

## Security

- `ANYTYPE_TOKEN` grants full access to your vault: the `.env` file is
  gitignored, never commit it.
- Every /rpc call requires the `BRIDGE_TOKEN` bearer secret.
- Bind to 127.0.0.1 or a tailscale IP only; never a public interface.
- The style profile op reports structure only (type names, block-style
  histogram, title length): no note text or titles leave the machine.

## API

`GET /health` -> `{ok, app_version}`

`POST /rpc` with `Authorization: Bearer $BRIDGE_TOKEN` and a JSON body
`{"op": ..., "space_id": ..., ...}`:

| op | params | does |
| --- | --- | --- |
| `list_types` | space_id | object types in the space |
| `style_profile` | space_id | structural style: types in use, block styles, title shape |
| `create_object` | space_id, name, type_name?/type_key?, markdown?, icon_emoji?, description? | create + fill with blocks |
| `append_markdown` | object_id, markdown | append blocks to an object |
| `read_object` | space_id, object_id | details + block tree as text |
| `search` | space_id, query, limit? | full-text search |
| `archive_object` | object_id | move to bin (recoverable delete) |
