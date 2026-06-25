import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { validateDef, type BankWidgetDef } from "@/lib/widgetBank";

// Serve the community widget bank: every valid JSON def in widget-bank/.
// Invalid files are skipped and reported so a bad PR can't break the picker.

let cache: { at: number; widgets: BankWidgetDef[]; errors: Record<string, string[]> } | null = null;
const TTL = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  if (process.env.NODE_ENV === "production" && cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ widgets: cache.widgets, errors: cache.errors });
  }
  const dir = path.join(process.cwd(), "widget-bank");
  const widgets: BankWidgetDef[] = [];
  const errors: Record<string, string[]> = {};
  try {
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith(".json")) continue;
      try {
        const def = JSON.parse(await readFile(path.join(dir, file), "utf8")) as BankWidgetDef;
        const errs = validateDef(def);
        if (errs.length) errors[file] = errs;
        else widgets.push(def);
      } catch (e) {
        errors[file] = [`unreadable: ${String(e instanceof Error ? e.message : e)}`];
      }
    }
  } catch { /* no widget-bank directory */ }
  cache = { at: Date.now(), widgets, errors };
  return NextResponse.json({ widgets, errors });
}
