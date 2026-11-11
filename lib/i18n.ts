import en, { type Messages } from "@/messages/en";

// UI languages. Strings live in messages/<code>.ts as nested objects with
// dotted keys ("common.save"); English is the source and the fallback, so a
// partial translation works. No hooks here (server code may import this);
// the React side is lib/useT.ts.
//
// Adding a language: create messages/<code>.ts (same shape as en.ts, any
// subset of keys), add it to LOCALES below. The settings drawer lists it.

type Dict = { [key: string]: string | Dict };
type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };
export type Translation = DeepPartial<Messages>;

export const LOCALES: Record<string, { label: string; messages: Translation }> = {
  en: { label: "English", messages: en },
};
export const DEFAULT_LOCALE = "en";
export const LOCALE_KEY = "language";      // the Setting key and the localStorage mirror
export const LOCALE_EVENT = "languagechange-ui";

// Every dotted key of the English file, so t("common.sav") is a type error.
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
type Unplural<K extends string> = K extends `${infer B}_one` | `${infer B}_other` ? B : K;
export type MessageKey = Unplural<Leaves<Messages>>;

function lookup(dict: Dict | undefined, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function readLocale(value: unknown): string {
  return typeof value === "string" && value in LOCALES ? value : DEFAULT_LOCALE;
}

// Translate a key for a locale. {name} placeholders are filled from vars; with
// a numeric `count`, the _one/_other form is picked by the locale's plural rule.
export function translate(locale: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const dicts = [LOCALES[locale]?.messages as Dict | undefined, en as unknown as Dict];
  let form = "";
  if (vars && typeof vars.count === "number") {
    let cat = "other";
    try { cat = new Intl.PluralRules(locale).select(vars.count); } catch { /* unknown locale */ }
    form = cat === "one" ? "_one" : "_other";
  }
  let text: string | undefined;
  for (const d of dicts) {
    text = (form && (lookup(d, key + form) ?? lookup(d, key + "_other"))) || lookup(d, key);
    if (text !== undefined) break;
  }
  if (text === undefined) return key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : text;
}
