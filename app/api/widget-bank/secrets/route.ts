import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, readJsonBody, requireUser } from "@/lib/http";
import { secretKeys } from "@/lib/widgetBank";
import { deleteSecrets, findDef, readSecrets, validInstance, writeSecrets } from "@/lib/widgetBankServer";

// A widget file's secret settings (docs/widget-bank.md). Write-only: the
// values are never sent back, only which ones are set.
// GET ?instance=&bankId=              -> { set: ["apiKey"] }
// PUT { instance, bankId, values }    -> { set } (a string sets, null clears, a missing key keeps)
// DELETE ?instance=                   -> clears every secret of that widget

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const instance = request.nextUrl.searchParams.get("instance");
  const def = await findDef(request.nextUrl.searchParams.get("bankId"));
  if (!validInstance(instance) || !def) return badRequest();
  const have = await readSecrets(user.id, instance);
  return json({ set: secretKeys(def).filter(k => !!have[k]) });
}

export async function PUT(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = await readJsonBody(request);
  const def = await findDef(body?.bankId);
  if (!body || !def || !validInstance(body.instance) || !body.values || typeof body.values !== "object") return badRequest();
  return json({ set: await writeSecrets(user.id, body.instance, def, body.values as Record<string, unknown>) });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const instance = request.nextUrl.searchParams.get("instance");
  if (!validInstance(instance)) return badRequest();
  await deleteSecrets(user.id, instance);
  return json({ ok: true });
}
