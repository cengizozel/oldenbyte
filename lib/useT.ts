"use client";

import { useCallback, useEffect, useState } from "react";
import * as storage from "@/lib/storage";
import { DEFAULT_LOCALE, LOCALE_EVENT, LOCALE_KEY, readLocale, translate, type MessageKey } from "@/lib/i18n";

// The current UI language, shared by every component: read once from
// localStorage (instant) and the stored setting, and updated live when the
// settings drawer changes it.
let current = DEFAULT_LOCALE;
let loaded = false;

export function setLocale(locale: string) {
  current = readLocale(locale);
  try { localStorage.setItem(LOCALE_KEY, current); } catch { /* private mode */ }
  storage.setItem(LOCALE_KEY, current);
  document.documentElement.lang = current;
  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: current }));
}

export function useLocale(): string {
  const [locale, setLocaleState] = useState(current);
  useEffect(() => {
    if (!loaded) {
      loaded = true;
      try { current = readLocale(localStorage.getItem(LOCALE_KEY)); } catch { /* private mode */ }
      storage.getItem(LOCALE_KEY).then(v => {
        const next = readLocale(v ?? current);
        if (next !== current) { current = next; window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: next })); }
      });
    }
    setLocaleState(current);
    const onChange = (e: Event) => setLocaleState((e as CustomEvent<string>).detail);
    window.addEventListener(LOCALE_EVENT, onChange);
    return () => window.removeEventListener(LOCALE_EVENT, onChange);
  }, []);
  return locale;
}

// const t = useT(); t("common.save"); t("common.removeNamed", { name })
export function useT() {
  const locale = useLocale();
  return useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}
