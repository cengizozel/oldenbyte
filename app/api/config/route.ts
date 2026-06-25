import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/http";

// Programmatic dashboard configuration. Mirrors the UI's export/import but in a
// hand-authorable shape: GET returns every config key with its value already
// parsed from JSON (so `widget-layout` is a real array, not an escaped string),
// and PUT/POST accepts the same shape, re-stringifying non-string values before
// storing. requireUser gates every handler (session cookie, or a Bearer API_KEY
// that resolves to the admin user), and all config is scoped to that user.
//
//   curl -H "Authorization: Bearer $API_KEY" https://host/api/config > dash.json
//   curl -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
//        -X PUT --data @dash.json "https://host/api/config?mode=replace"

// Date-stamped caches and epub location caches are runtime-regenerated; they are
// never part of a config and are excluded from both export and import.
function isCache(key: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(key) || key.startsWith("epub-locs-");
}

// Stored values are JSON strings for structured config and bare strings for
// scalars like theme/timezone. Decode only objects/arrays to the structured
// value (so `widget-layout` reads as a real array); scalars stay verbatim
// strings, which keeps the round-trip lossless — a stored "123" or "true" is
// never silently turned into a number/boolean.
function decode(value: string): unknown {
  const t = value.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      /* fall through: keep the raw string */
    }
  }
  return value;
}

function encode(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const all = await prisma.setting.findMany({ where: { userId: user.id } });
  const data: Record<string, unknown> = {};
  for (const { key, value } of all) {
    if (!isCache(key)) data[key] = decode(value);
  }
  return NextResponse.json(data);
}

async function applyConfig(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const replace = new URL(request.url).searchParams.get("mode") === "replace";

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return NextResponse.json({ error: "Body must be a JSON object of config keys" }, { status: 400 });
  }

  // Keep only real config entries: skip undefined values and any cache keys.
  const entries = Object.entries(data as Record<string, unknown>)
    .filter(([k, v]) => v !== undefined && !isCache(k))
    .map(([k, v]) => [k, encode(v)] as [string, string]);
  const keep = new Set(entries.map(([k]) => k));

  // Guard the destructive path: an empty (or truncated-to-empty) body in replace
  // mode would otherwise delete every config key. Refuse rather than wipe.
  if (replace && entries.length === 0) {
    return NextResponse.json(
      { error: "Refusing to replace with an empty config; this would delete everything. Send the full config, or use the default merge mode." },
      { status: 400 }
    );
  }

  // Replace mode prunes existing config keys absent from the payload (caches are
  // left untouched), so the dashboard ends up exactly matching the config.
  const toDelete = replace
    ? (await prisma.setting.findMany({ where: { userId: user.id }, select: { key: true } }))
        .map(e => e.key)
        .filter(k => !isCache(k) && !keep.has(k))
    : [];

  const ops = [
    ...(toDelete.length ? [prisma.setting.deleteMany({ where: { userId: user.id, key: { in: toDelete } } })] : []),
    ...entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { userId_key: { userId: user.id, key } },
        update: { value },
        create: { userId: user.id, key, value },
      })
    ),
  ];
  await prisma.$transaction(ops);

  // Echo what was removed so a caller can spot an unintended prune.
  return NextResponse.json({ ok: true, written: entries.length, deleted: toDelete.length, mode: replace ? "replace" : "merge" });
}

export const PUT = applyConfig;
export const POST = applyConfig;
