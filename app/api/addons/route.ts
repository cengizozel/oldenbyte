import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, bodyTooLarge, readJsonBody, requireUser, errorResponse } from "@/lib/http";
import { assertSettingsRoom } from "@/lib/quota";
import { validateAddon, MAX_ADDON_BYTES, MAX_USER_ADDONS, type Addon } from "@/lib/addons";
import { listAddons, shippedAddons, userAddons, saveUserAddons, USER_ADDONS_KEY } from "@/lib/addonsServer";

// Add-ons (docs/addons.md).
// GET              -> { addons: [{ ...addon, source }], errors } (errors: bad files in addons/, admins only)
// POST { addon }   -> adds or replaces one of the user's own add-ons
// DELETE ?id=      -> removes one of the user's own add-ons

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const addons = await listAddons(user.id);
  const errors = user.role === "admin" ? (await shippedAddons()).errors : {};
  return json({ addons, errors });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  if (bodyTooLarge(request, MAX_ADDON_BYTES * 2)) return json({ error: "That file is too large for an add-on." }, 413);
  const body = await readJsonBody(request);
  const def = body?.addon;
  if (!def || JSON.stringify(def).length > MAX_ADDON_BYTES) return badRequest("That file is too large for an add-on, or empty.");
  const errors = validateAddon(def);
  if (errors.length) return json({ error: "This is not a valid add-on.", errors }, 400);
  const addon = def as Addon;
  if ((await shippedAddons()).addons.some(a => a.id === addon.id)) return json({ error: `An add-on named "${addon.id}" already comes with oldenbyte.` }, 409);
  try {
    const mine = (await userAddons(user.id)).filter(a => a.id !== addon.id);
    if (mine.length >= MAX_USER_ADDONS) return json({ error: `You can keep at most ${MAX_USER_ADDONS} add-ons. Remove one first.` }, 400);
    const next = [...mine, addon];
    await assertSettingsRoom(user, [[USER_ADDONS_KEY, JSON.stringify(next)]]);
    await saveUserAddons(user.id, next);
    return json({ ok: true, addon: { ...addon, source: "yours" } });
  } catch (e) {
    return errorResponse(e, "addons");
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const mine = await userAddons(user.id);
  if (!mine.some(a => a.id === id)) return json({ error: "Not found" }, 404);
  await saveUserAddons(user.id, mine.filter(a => a.id !== id));
  return json({ ok: true });
}
