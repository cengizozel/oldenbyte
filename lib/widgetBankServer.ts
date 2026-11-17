// Server side of widget files (lib/widgetBank.ts): reading the definitions in
// widget-bank/, and the secrets (API keys, tokens) users type into them. Node
// runtime only.
import { readdir, readFile } from "fs/promises";
import path from "path";
import { prisma } from "./prisma";
import { validateDef, secretKeys, type BankWidgetDef } from "./widgetBank";

let cache: { at: number; widgets: BankWidgetDef[]; errors: Record<string, string[]> } | null = null;
const TTL = 5 * 60 * 1000;

// Every valid definition in widget-bank/. A bad file is skipped and reported,
// so a broken pull request cannot take the picker down.
export async function loadBank(): Promise<{ widgets: BankWidgetDef[]; errors: Record<string, string[]> }> {
  if (process.env.NODE_ENV === "production" && cache && Date.now() - cache.at < TTL) return cache;
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
        else if (widgets.some(w => w.id === def.id)) errors[file] = [`id "${def.id}" is already used`];
        else widgets.push(def);
      } catch (e) {
        errors[file] = [`unreadable: ${String(e instanceof Error ? e.message : e)}`];
      }
    }
  } catch { /* no widget-bank directory */ }
  cache = { at: Date.now(), widgets, errors };
  return cache;
}

export async function findDef(id: unknown): Promise<BankWidgetDef | null> {
  return typeof id === "string" ? (await loadBank()).widgets.find(w => w.id === id) ?? null : null;
}

// ── Secrets ──────────────────────────────────────────────────────────────────
// A widget file's "secret" settings are write-only: saved here, used by the
// server when it makes the widget's request, never sent to a browser again.
// They live in the AppConfig table on purpose, not with the user's settings:
// nothing that reads settings (the settings API, the app API, backups) can
// reach them. One row per placed widget.
const INSTANCE = /^[A-Za-z0-9._:-]{1,120}$/;
const secretRow = (userId: string, instance: string) => `widgetSecret:${userId}:${instance}`;
export const validInstance = (v: unknown): v is string => typeof v === "string" && INSTANCE.test(v);

export async function readSecrets(userId: string, instance: string): Promise<Record<string, string>> {
  const row = await prisma.appConfig.findUnique({ where: { key: secretRow(userId, instance) } });
  if (!row) return {};
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Sets (a string) or clears (null) secrets of one placed widget. Only keys
// the definition declares as secrets are kept.
export async function writeSecrets(userId: string, instance: string, def: BankWidgetDef, changes: Record<string, unknown>): Promise<string[]> {
  const allowed = new Set(secretKeys(def));
  const current = await readSecrets(userId, instance);
  const next: Record<string, string> = {};
  for (const key of allowed) {
    const change = changes[key];
    if (change === null) continue;
    if (typeof change === "string" && change.trim()) next[key] = change.trim().slice(0, 2000);
    else if (current[key]) next[key] = current[key];
  }
  const key = secretRow(userId, instance);
  if (Object.keys(next).length === 0) await prisma.appConfig.deleteMany({ where: { key } });
  else {
    const value = JSON.stringify(next);
    await prisma.appConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  return Object.keys(next);
}

export async function deleteSecrets(userId: string, instance?: string): Promise<void> {
  if (instance) await prisma.appConfig.deleteMany({ where: { key: secretRow(userId, instance) } });
  else await prisma.appConfig.deleteMany({ where: { key: { startsWith: `widgetSecret:${userId}:` } } });
}
