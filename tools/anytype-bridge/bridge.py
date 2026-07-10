#!/usr/bin/env python3
"""Anytype write bridge for the oldenbyte dashboard.

Anytype's full-power gRPC API (anytype-heart) listens on a loopback-only,
dynamically numbered port next to the desktop app, so nothing off-machine can
reach it. This bridge runs ON the machine with the Anytype desktop app and
exposes the handful of operations the dashboard's chat assistant needs as a
tiny JSON-over-HTTP service the dashboard can call (locally in dev, over
tailscale in prod).

It drives anytype-grpc (github.com/cengizozel/anytype-grpc), so writes are
block-level: real headers, bullets, checkboxes, and code blocks, not one
markdown blob.

Environment:
  ANYTYPE_TOKEN      required - full session token (python -m anytype_grpc.auth)
  ANYTYPE_GRPC_ADDR  optional - host:port of anytype-heart (auto-discovered)
  BRIDGE_TOKEN       required - shared secret the dashboard must send as
                     "Authorization: Bearer <token>"
  BRIDGE_HOST        optional - bind address (default 127.0.0.1; set to the
                     tailscale IP to accept calls from the prod server)
  BRIDGE_PORT        optional - port (default 31010)

Endpoints:
  GET  /health  -> {ok, app_version}   (no auth; reveals nothing sensitive)
  POST /rpc     -> {op: ..., ...params}, Bearer auth required

Ops: list_types, style_profile, create_object, append_markdown, read_object,
search, archive_object. Errors come back as {"error": "..."} with HTTP 400/500
so the caller always gets readable JSON.
"""

import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import anytype_grpc
except ImportError:
    print("anytype-grpc is not installed. Run setup.sh (or: pip install "
          '"anytype-grpc @ git+https://github.com/cengizozel/anytype-grpc.git")',
          file=sys.stderr)
    sys.exit(1)

BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
BRIDGE_HOST = os.environ.get("BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "31010"))

_client_lock = threading.Lock()
_client = None


def client():
    """Lazily connect; reconnect if the app restarted (its gRPC port moves)."""
    global _client
    with _client_lock:
        if _client is None:
            _client = anytype_grpc.Anytype()
        return _client


def reset_client():
    global _client
    with _client_lock:
        _client = None


# ── Markdown -> blocks ─────────────────────────────────────────────────────────
# A deliberate subset: headings, bullets, numbered lists, checkboxes, quotes,
# code fences, dividers, paragraphs. Inline bold/italic markers are stripped
# (block marks are a later refinement); text lands verbatim otherwise.

INLINE_MD = re.compile(r"\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|`(.+?)`")


def strip_inline(text):
    return INLINE_MD.sub(lambda m: next(g for g in m.groups() if g is not None), text)


def markdown_to_blocks(at, page_id, markdown):
    """Append the markdown to the object as real Anytype blocks. Returns count."""
    lines = markdown.replace("\r\n", "\n").split("\n")
    count = 0
    para = []

    def flush_para():
        nonlocal count
        if para:
            at.blocks.add_text(page_id, strip_inline(" ".join(para).strip()))
            para.clear()
            count += 1

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_para()
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            at.blocks.add_code(page_id, "\n".join(code))
            count += 1
            i += 1
            continue

        m = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if m:
            flush_para()
            at.blocks.add_header(page_id, strip_inline(m.group(2)), level=len(m.group(1)))
            count += 1
            i += 1
            continue

        m = re.match(r"^[-*]\s+\[([ xX])\]\s+(.*)$", stripped)
        if m:
            flush_para()
            at.blocks.add_checkbox(page_id, strip_inline(m.group(2)), checked=m.group(1).lower() == "x")
            count += 1
            i += 1
            continue

        m = re.match(r"^[-*]\s+(.*)$", stripped)
        if m:
            flush_para()
            at.blocks.add_marked(page_id, strip_inline(m.group(1)))
            count += 1
            i += 1
            continue

        m = re.match(r"^\d+[.)]\s+(.*)$", stripped)
        if m:
            flush_para()
            at.blocks.add_marked(page_id, strip_inline(m.group(1)), numbered=True)
            count += 1
            i += 1
            continue

        m = re.match(r"^>\s?(.*)$", stripped)
        if m:
            flush_para()
            at.blocks.add_text(page_id, strip_inline(m.group(1)), style="Quote")
            count += 1
            i += 1
            continue

        if re.match(r"^(-{3,}|\*{3,})$", stripped):
            flush_para()
            at.blocks.add_divider(page_id)
            count += 1
            i += 1
            continue

        if stripped == "":
            flush_para()
        else:
            para.append(stripped)
        i += 1

    flush_para()
    return count


# ── Block tree -> readable text (for read_object) ─────────────────────────────

def blocks_to_text(view):
    """Flatten an objectView's block list into markdown-ish text, in tree order."""
    blocks = {b.get("id"): b for b in view.get("blocks", [])}
    root = view.get("rootId") or next(iter(blocks), None)
    out = []

    def walk(bid, depth):
        b = blocks.get(bid)
        if not b:
            return
        t = b.get("text")
        if t:
            style = t.get("style", "Paragraph")
            text = t.get("text", "")
            prefix = {
                "Header1": "# ", "Header2": "## ", "Header3": "### ",
                "Marked": "- ", "Numbered": "1. ", "Quote": "> ",
                "Checkbox": "- [x] " if t.get("checked") else "- [ ] ",
                "Toggle": "- ",
            }.get(style, "")
            if style == "Code":
                out.append(f"```\n{text}\n```")
            elif text:
                out.append("  " * max(0, depth - 1) + prefix + text)
        for child in b.get("childrenIds", []):
            walk(child, depth + 1)

    if root:
        for child in blocks.get(root, {}).get("childrenIds", []):
            walk(child, 0)
    return "\n".join(out)


# ── Ops ────────────────────────────────────────────────────────────────────────

def op_list_types(at, p):
    rows = at.types.list_types(p["space_id"])
    return {
        "types": [
            {"id": r.get("id"), "key": r.get("uniqueKey"), "name": r.get("name"),
             "layout": r.get("recommendedLayout")}
            for r in rows
            if r.get("name") and not r.get("isArchived")
        ]
    }


PROFILE_SAMPLE = 12


def op_style_profile(at, p):
    """A STRUCTURAL profile of the space: which types are in active use, which
    block styles recent notes are built from, and title shape. Contains no note
    text and no titles - safe to hand to a model as style guidance."""
    space = p["space_id"]
    types = {t.get("id"): t for t in at.types.list_types(space)}
    recent = at.search("", space_id=space, limit=40)

    type_counts = {}
    for r in recent:
        # search rows carry a type field in various shapes across versions
        tname = ""
        t = r.get("type")
        if isinstance(t, dict):
            tname = t.get("name", "")
        elif isinstance(t, str):
            tname = types.get(t, {}).get("name", t)
        if tname:
            type_counts[tname] = type_counts.get(tname, 0) + 1

    block_hist = {}
    title_words = []
    icon_count = 0
    sampled = 0
    for r in recent[:PROFILE_SAMPLE]:
        oid = r.get("id")
        if not oid:
            continue
        try:
            view = at.get_object(oid, space_id=space).get("objectView", {})
        except Exception:
            continue
        sampled += 1
        name = r.get("name") or ""
        if name:
            title_words.append(len(name.split()))
        if r.get("iconEmoji"):
            icon_count += 1
        for b in view.get("blocks", []):
            t = b.get("text")
            if t and t.get("text"):
                style = t.get("style", "Paragraph")
                block_hist[style] = block_hist.get(style, 0) + 1
            elif "div" in b:
                block_hist["Divider"] = block_hist.get("Divider", 0) + 1

    return {
        "types_in_use": sorted(type_counts.items(), key=lambda x: -x[1]),
        "all_types": sorted(t.get("name") for t in types.values() if t.get("name")),
        "block_styles": sorted(block_hist.items(), key=lambda x: -x[1]),
        "title_avg_words": round(sum(title_words) / len(title_words), 1) if title_words else None,
        "icon_emoji_ratio": round(icon_count / sampled, 2) if sampled else None,
        "sampled_objects": sampled,
    }


def op_create_object(at, p):
    space = p["space_id"]
    name = str(p.get("name", "")).strip()
    if not name:
        raise ValueError("name is required")

    # Resolve the type: accept a unique key (ot-...) or a human name matched
    # against the space's types; default to a plain page.
    type_key = str(p.get("type_key", "")).strip()
    type_name = str(p.get("type_name", "")).strip()
    if not type_key:
        if type_name:
            rows = at.types.list_types(space)
            match = next(
                (r for r in rows if (r.get("name") or "").strip().lower() == type_name.lower()),
                None,
            ) or next(
                (r for r in rows if type_name.lower() in (r.get("name") or "").lower()),
                None,
            )
            if not match:
                raise ValueError(f'No type named "{type_name}" in this space')
            type_key = match.get("uniqueKey") or "ot-page"
        else:
            type_key = "ot-page"

    details = {"name": name}
    if p.get("description"):
        details["description"] = str(p["description"])
    object_id = at.objects.create(type_key, details=details, space_id=space)

    if p.get("icon_emoji"):
        try:
            at.objects.set_icon(object_id, emoji=str(p["icon_emoji"]))
        except Exception:
            pass  # icon is cosmetic; never fail the create over it

    blocks_added = 0
    if p.get("markdown"):
        blocks_added = markdown_to_blocks(at, object_id, str(p["markdown"]))

    return {
        "object_id": object_id,
        "type_key": type_key,
        "blocks_added": blocks_added,
        "deeplink": f"anytype://object?objectId={object_id}&spaceId={space}",
    }


def op_append_markdown(at, p):
    object_id = str(p.get("object_id", "")).strip()
    md = str(p.get("markdown", ""))
    if not object_id or not md.strip():
        raise ValueError("object_id and markdown are required")
    count = markdown_to_blocks(at, object_id, md)
    return {"object_id": object_id, "blocks_added": count}


def op_read_object(at, p):
    view = at.get_object(p["object_id"], space_id=p["space_id"]).get("objectView", {})
    details = {}
    for d in view.get("details", []):
        if d.get("id") == view.get("rootId"):
            details = d.get("details", {})
            break
    return {
        "name": details.get("name", ""),
        "type": details.get("type", ""),
        "text": blocks_to_text(view),
    }


def op_search(at, p):
    rows = at.search(str(p.get("query", "")), space_id=p["space_id"],
                     limit=int(p.get("limit", 8)))
    return {
        "results": [
            {"id": r.get("id"), "name": r.get("name"), "snippet": r.get("snippet", "")}
            for r in rows
        ]
    }


def op_archive_object(at, p):
    """Archive (move to bin) - the recoverable form of delete."""
    object_id = str(p.get("object_id", "")).strip()
    if not object_id:
        raise ValueError("object_id is required")
    at.objects.set_archived([object_id], archived=True)
    return {"object_id": object_id, "archived": True}


OPS = {
    "list_types": op_list_types,
    "style_profile": op_style_profile,
    "create_object": op_create_object,
    "append_markdown": op_append_markdown,
    "read_object": op_read_object,
    "search": op_search,
    "archive_object": op_archive_object,
}


# ── HTTP plumbing ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "oldenbyte-anytype-bridge/1.0"

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[bridge] %s\n" % (fmt % args))

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        try:
            version = client().app_version()
            return self._send(200, {"ok": True, "app_version": str(version)})
        except Exception as e:
            reset_client()
            return self._send(200, {"ok": False, "error": str(e)})

    def do_POST(self):
        if self.path != "/rpc":
            return self._send(404, {"error": "not found"})
        auth = self.headers.get("Authorization", "")
        if not BRIDGE_TOKEN or auth != f"Bearer {BRIDGE_TOKEN}":
            return self._send(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "invalid JSON body"})

        op = payload.pop("op", "")
        fn = OPS.get(op)
        if not fn:
            return self._send(400, {"error": f"unknown op '{op}'", "ops": sorted(OPS)})
        # Space-scoped ops must say which space; refuse rather than guess.
        if op in ("list_types", "style_profile", "create_object", "read_object", "search") and not payload.get("space_id"):
            return self._send(400, {"error": "space_id is required"})
        try:
            return self._send(200, fn(client(), payload))
        except (ValueError, KeyError) as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            # a dead channel usually means the app restarted; reconnect next call
            reset_client()
            return self._send(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    if not BRIDGE_TOKEN:
        print("BRIDGE_TOKEN is required (any long random string; the dashboard "
              "sends it as a Bearer token).", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("ANYTYPE_TOKEN"):
        print("ANYTYPE_TOKEN is required. Mint one with: python -m anytype_grpc.auth",
              file=sys.stderr)
        sys.exit(1)
    server = ThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), Handler)
    print(f"[bridge] listening on {BRIDGE_HOST}:{BRIDGE_PORT}", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
