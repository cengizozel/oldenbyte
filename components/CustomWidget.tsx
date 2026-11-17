"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Blocks, type LucideIcon } from "lucide-react";
import { colorMap, type ColorClasses, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { useWidgetActive } from "@/lib/activeDashboard";
import {
  FRAME_SANDBOX, DATA_KEY, MAX_DATA_KEYS, MAX_DATA_VALUE, MAX_SUMMARY, POWER_DETAIL, POWER_LABEL,
  configKey, dataKey, frameDocument, iconMask, missingPowers, settingValues, summaryKey,
  type CustomField, type CustomManifest, type ElevatedSettings, type FrameLook, type InstalledWidget,
} from "@/lib/customWidgets";
import { loadSource, setCustomWidgetEnabled, useCustomWidgets } from "@/lib/useCustomWidgets";
import FlipCard from "@/components/ui/FlipCard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Toggle from "@/components/ui/Toggle";
import { SettingsInput, SettingsSelect, SettingsTextarea } from "@/components/ui/Field";
import { WidgetHeader, EmptyState, LoadingState, SettingsFace, SettingsField, SettingsInfo, SettingsError, SmallButton } from "@/components/ui/WidgetChrome";

// A custom widget (docs/custom-widgets.md): someone else's HTML file, drawn
// inside oldenbyte's own card. The header, the settings face and the colors
// are oldenbyte's; the body is the file, in a sandboxed frame that can only
// talk to this component (lib/customWidgets.ts explains the sandbox). Every
// message from the frame is a request this component may refuse.

type Saved = { values?: Record<string, unknown>; keys?: string[] };
type Values = Record<string, string | number | boolean>;

// A manifest icon as a header icon. It is only ever painted as a CSS mask.
const maskIcons = new Map<string, LucideIcon>();
function iconFor(manifest: CustomManifest | undefined): LucideIcon {
  const mask = iconMask(manifest);
  if (!mask) return Blocks;
  let icon = maskIcons.get(mask);
  if (!icon) {
    const Masked = ({ size = 14, className = "" }: { size?: number | string; className?: string }) => (
      <span aria-hidden className={`inline-block bg-current ${className}`} style={{ width: size, height: size, maskImage: mask, WebkitMaskImage: mask, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" }} />
    );
    icon = Masked as unknown as LucideIcon;
    maskIcons.set(mask, icon);
  }
  return icon;
}

// What the user is told before a widget from outside is added or switched on.
// Standard widgets get one plain notice; elevated ones name every power.
export function widgetWarning(manifest: CustomManifest, account: ElevatedSettings): { title: string; detail: ReactNode; confirm: string; startsOff: boolean } {
  const powers = manifest.powers ?? [];
  const by = manifest.author ? `, written by ${manifest.author}` : "";
  if (!powers.length) {
    return {
      title: `Add ${manifest.name}?`,
      confirm: "Add widget",
      startsOff: false,
      detail: (
        <>
          <p>This is code from outside oldenbyte{by}. oldenbyte has not checked it.</p>
          <p>It runs in a sandbox: it keeps its own data and settings, and cannot read your dashboard, your other widgets, your files or your sign-in, and cannot contact any server.</p>
        </>
      ),
    };
  }
  const startsOff = missingPowers(powers, account).length > 0;
  return {
    title: `${manifest.name} asks for more than a normal widget`,
    confirm: startsOff ? "Add, switched off" : "I trust it, switch it on",
    startsOff,
    detail: (
      <>
        <p>This is code from outside oldenbyte{by}. oldenbyte has not checked it, and it asks to do things a normal widget cannot:</p>
        <ul className="flex flex-col gap-1.5">
          {powers.map(p => (
            <li key={p}>
              <span className="font-medium text-[var(--text-primary)]">{POWER_LABEL[p]}.</span> {POWER_DETAIL[p]}
            </li>
          ))}
        </ul>
        <p>{powers.length > 1 ? "Together these let it send what it reads anywhere. " : ""}Only continue if you trust who wrote it.</p>
        {startsOff && <p>It will be added switched off, because elevated widgets (or one of these powers) are off in Settings, Custom widgets.</p>}
      </>
    ),
  };
}

function readLook(text: HTMLElement | null, muted: HTMLElement | null, surface: HTMLElement | null): FrameLook | null {
  if (!text || !muted || !surface) return null;
  const s = getComputedStyle(surface);
  return {
    dark: document.documentElement.classList.contains("dark"),
    text: getComputedStyle(text).color,
    muted: getComputedStyle(muted).color,
    bg: s.backgroundColor,
    border: s.borderTopColor,
  };
}

function FieldControl({ field, value, onChange }: { field: CustomField; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  if (field.type === "toggle") return <Toggle checked={value === true} onChange={() => onChange(value !== true)} label={field.label} />;
  if (field.type === "select") {
    return (
      <SettingsSelect value={String(value)} onChange={e => onChange(e.target.value)}>
        {(field.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </SettingsSelect>
    );
  }
  if (field.type === "textarea") return <SettingsTextarea value={String(value)} onChange={e => onChange(e.target.value)} rows={4} placeholder={field.placeholder} maxLength={4000} />;
  if (field.type === "number") return <SettingsInput type="number" value={String(value)} onChange={e => onChange(e.target.value === "" ? 0 : Number(e.target.value))} placeholder={field.placeholder} />;
  return (
    <SettingsInput
      type={field.type === "secret" ? "password" : "text"}
      autoComplete="off"
      value={String(value)}
      onChange={e => onChange(e.target.value)}
      placeholder={field.placeholder}
      maxLength={4000}
    />
  );
}

export default function CustomWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const { loaded, widgets: installed, elevated } = useCustomWidgets();
  const info = installed.find(w => w.ext === widget.ext);
  const missing = info ? missingPowers(info.manifest.powers, elevated) : [];
  const runnable = !!info && info.enabled && missing.length === 0;

  return (
    <CustomWidgetBody
      // A new file (an update) or a different widget starts from scratch.
      key={info ? `${info.ext}@${info.installedAt}` : "none"}
      widget={widget}
      className={className}
      c={c}
      loaded={loaded}
      info={info}
      missing={missing.map(p => POWER_LABEL[p])}
      runnable={runnable}
      elevated={elevated}
    />
  );
}

function CustomWidgetBody({ widget, className, c, loaded, info, missing, runnable, elevated }: {
  widget: Widget; className: string; c: ColorClasses; loaded: boolean;
  info: InstalledWidget | undefined; missing: string[]; runnable: boolean; elevated: ElevatedSettings;
}) {
  const manifest = info?.manifest;
  const active = useWidgetActive();
  const [source, setSource] = useState<string | null | undefined>(undefined);
  const [saved, setSaved] = useState<Saved | null>(null); // null until read
  // What the frame was started with. It is rebuilt (the widget restarts) only
  // when this changes: a new file, or settings saved for a widget that does
  // not listen for them.
  const [boot, setBoot] = useState<{ values: Values; look: FrameLook; nonce: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<Values>({});
  const [badge, setBadge] = useState("");
  const [error, setError] = useState("");
  const [confirmOn, setConfirmOn] = useState(false);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const textProbe = useRef<HTMLSpanElement>(null);
  const mutedProbe = useRef<HTMLSpanElement>(null);
  const surfaceProbe = useRef<HTMLSpanElement>(null);
  const savedRef = useRef<Saved>({});
  const listening = useRef(new Set<string>());
  const cfgKey = configKey(widget.id);

  useEffect(() => {
    if (!info || !runnable) return;
    let gone = false;
    loadSource(info).then(html => { if (!gone) setSource(html); });
    return () => { gone = true; };
  }, [info, runnable]);

  useEffect(() => {
    if (!manifest) return;
    let gone = false;
    storage.getItemResult(cfgKey).then(res => {
      if (gone || !res.ok) return;
      let parsed: Saved = {};
      try { if (res.value) parsed = JSON.parse(res.value) as Saved; } catch {}
      savedRef.current = parsed;
      setSaved(parsed);
      const look = readLook(textProbe.current, mutedProbe.current, surfaceProbe.current);
      if (look) setBoot({ values: settingValues(manifest, parsed.values), look, nonce: 0 });
    });
    return () => { gone = true; };
  }, [cfgKey, manifest]);

  const post = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ ob: 1, ...message }, "*");
  }, []);

  // The theme follows the dashboard without restarting the widget.
  const sendLook = useCallback(() => {
    const look = readLook(textProbe.current, mutedProbe.current, surfaceProbe.current);
    if (look) post({ event: "theme", value: look });
    if (frameRef.current && look) frameRef.current.style.colorScheme = look.dark ? "dark" : "light";
  }, [post]);
  useEffect(() => {
    sendLook();
    const mo = new MutationObserver(sendLook);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, [sendLook, widget.color]);
  useEffect(() => { post({ event: "visible", value: active }); }, [active, post]);
  useEffect(() => { post({ event: "title", value: widget.title }); }, [widget.title, post]);

  const frame = useMemo(() => {
    if (!manifest || !source || !boot) return null;
    return frameDocument(source, {
      instance: { id: widget.id, title: widget.title },
      widget: { id: manifest.id, name: manifest.name, version: manifest.version },
      settings: boot.values,
      powers: manifest.powers ?? [],
      theme: boot.look,
      visible: true,
    }, window.location.origin);
    // The title is sent as an event; a rename must not restart the widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, source, boot, widget.id]);

  // ── The bridge: what the frame may ask for ─────────────────────────────────
  const handle = useCallback(async (op: string, args: Record<string, unknown>): Promise<unknown> => {
    const ext = widget.ext ?? "";
    const writeSaved = (next: Saved) => {
      savedRef.current = next;
      return storage.setItem(cfgKey, JSON.stringify(next), { quiet: true });
    };
    const elevatedCall = async (name: string, a: Record<string, unknown>) => {
      const res = await fetch("/api/custom-widgets/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ext, op: name, args: a }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${res.status}).`);
      return data;
    };
    const key = typeof args.key === "string" ? args.key : "";
    switch (op) {
      case "listen":
        if (typeof (args as unknown) === "string") listening.current.add(args as unknown as string);
        return true; // the name arrives as the whole argument
      case "storage.get": {
        if (!DATA_KEY.test(key)) throw new Error("Storage keys are 1 to 64 characters of letters, digits, dot, dash and underscore.");
        const raw = await storage.getItem(dataKey(widget.id, key));
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch { return null; }
      }
      case "storage.set": {
        if (!DATA_KEY.test(key)) throw new Error("Storage keys are 1 to 64 characters of letters, digits, dot, dash and underscore.");
        const value = JSON.stringify(args.value ?? null);
        if (value.length > MAX_DATA_VALUE) throw new Error(`A stored value can be at most ${MAX_DATA_VALUE / 1000} KB.`);
        const keys = savedRef.current.keys ?? [];
        if (!keys.includes(key)) {
          if (keys.length >= MAX_DATA_KEYS) throw new Error(`A widget can keep at most ${MAX_DATA_KEYS} storage keys.`);
          await writeSaved({ ...savedRef.current, keys: [...keys, key] });
        }
        if (!(await storage.setItem(dataKey(widget.id, key), value, { quiet: true }))) throw new Error("Could not save.");
        return true;
      }
      case "storage.remove": {
        if (!DATA_KEY.test(key)) return false;
        await storage.removeItem(dataKey(widget.id, key));
        await writeSaved({ ...savedRef.current, keys: (savedRef.current.keys ?? []).filter(k => k !== key) });
        return true;
      }
      case "storage.keys":
        return savedRef.current.keys ?? [];
      case "open": {
        const url = typeof args.url === "string" ? args.url : "";
        if (!/^https?:\/\//i.test(url)) throw new Error("Only http and https links can be opened.");
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      }
      case "badge":
        setBadge(typeof args.text === "string" ? args.text.slice(0, 12) : "");
        return true;
      case "summary":
        await storage.setItem(summaryKey(widget.id), (typeof args.text === "string" ? args.text : "").slice(0, MAX_SUMMARY), { quiet: true });
        return true;
      case "net.fetch":
        return elevatedCall(op, args);
      case "net.media":
      case "files.url":
        return window.location.origin + (await elevatedCall(op, args)).url;
      case "widgets.list":
        return (await elevatedCall(op, args)).widgets;
      case "widgets.read": {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        return (await elevatedCall(op, { ...args, today, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })).text;
      }
      case "files.list":
        return elevatedCall(op, args);
      default:
        throw new Error(`Unknown request "${op}".`);
    }
  }, [cfgKey, widget.ext, widget.id]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const d = e.data as { ob?: number; id?: number; op?: string; args?: unknown } | null;
      if (!d || d.ob !== 1 || typeof d.id !== "number" || typeof d.op !== "string") return;
      const id = d.id;
      const args = (d.op === "listen" ? d.args : d.args && typeof d.args === "object" ? d.args : {}) as Record<string, unknown>;
      handle(d.op, args).then(
        result => win.postMessage({ ob: 1, reply: id, result }, "*"),
        err => win.postMessage({ ob: 1, reply: id, error: String(err instanceof Error ? err.message : err) }, "*"),
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handle]);

  function openSettings() {
    if (!manifest) return;
    setDraft(settingValues(manifest, savedRef.current.values));
    setError("");
    setSettingsOpen(true);
  }

  function saveSettings() {
    if (!manifest) return;
    const next: Saved = { ...savedRef.current, values: draft };
    savedRef.current = next;
    setSaved(next);
    storage.setItem(cfgKey, JSON.stringify(next));
    const values = settingValues(manifest, draft);
    // A widget that listens for settings takes them live; any other restarts.
    if (listening.current.has("settings")) post({ event: "settings", value: values });
    else {
      const look = readLook(textProbe.current, mutedProbe.current, surfaceProbe.current);
      listening.current = new Set();
      setBadge("");
      if (look) setBoot(b => ({ values, look, nonce: (b?.nonce ?? 0) + 1 }));
    }
    setSettingsOpen(false);
  }

  async function switchOn() {
    setConfirmOn(false);
    if (!info) return;
    const res = await setCustomWidgetEnabled(info.ext, true);
    if (!res.ok) setError(res.error);
  }

  const fields = manifest?.settings ?? [];
  const title = widget.title;
  let body: ReactNode;
  if (!loaded) body = <LoadingState c={c} />;
  else if (!info || !manifest) body = <EmptyState c={c}>this widget&apos;s file is not installed any more; its data is kept</EmptyState>;
  else if (missing.length) body = <EmptyState c={c}>switched off: it asks for {missing.join(", ").toLowerCase()}, which is off in Settings, Custom widgets</EmptyState>;
  else if (!info.enabled) {
    body = (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className={`text-sm opacity-70 ${c.text}`}>this widget is switched off</p>
        <SmallButton c={c} onClick={() => setConfirmOn(true)}>Switch on</SmallButton>
        {error && <SettingsError>{error}</SettingsError>}
      </div>
    );
  } else if (source === null) body = <EmptyState c={c}>the widget&apos;s file could not be loaded</EmptyState>;
  else if (!frame) body = <LoadingState c={c} />;
  else {
    body = (
      <iframe
        ref={frameRef}
        key={boot?.nonce ?? 0}
        srcDoc={frame}
        title={manifest.name}
        sandbox={FRAME_SANDBOX}
        allow="autoplay"
        referrerPolicy="no-referrer"
        onLoad={() => { sendLook(); post({ event: "visible", value: active }); }}
        className="flex-1 min-h-0 w-full border-0 block bg-transparent"
        style={{ colorScheme: boot?.look.dark ? "dark" : "light" }}
      />
    );
  }

  return (
    <>
      <FlipCard
        c={c}
        flipped={settingsOpen}
        className={className}
        front={
          <>
            <WidgetHeader
              c={c}
              icon={iconFor(manifest)}
              title={title}
              after={badge ? <span className={`text-sm opacity-70 tabular-nums ${c.label}`}>{badge}</span> : undefined}
              onSettings={manifest && saved ? openSettings : undefined}
            />
            <span ref={textProbe} aria-hidden className={`hidden ${c.text}`} />
            <span ref={mutedProbe} aria-hidden className={`hidden ${c.label}`} />
            <span ref={surfaceProbe} aria-hidden className={`hidden border ${c.bg} ${c.border}`} />
            {body}
          </>
        }
        back={
          <SettingsFace c={c} onSave={saveSettings} onCancel={() => setSettingsOpen(false)} onReset={manifest && fields.length ? () => setDraft(settingValues(manifest, undefined)) : undefined}>
            {manifest && fields.map(f => (
              <SettingsField key={f.key} c={c} label={f.label} hint={f.hint} inline={f.type === "toggle"}>
                <FieldControl field={f} value={draft[f.key] ?? ""} onChange={v => setDraft(d => ({ ...d, [f.key]: v }))} />
              </SettingsField>
            ))}
            {manifest && (
              <SettingsInfo
                c={c}
                title={`${manifest.name} ${manifest.version}`}
                items={[
                  manifest.description,
                  `${info?.source === "community" ? "From the community catalog" : "Uploaded by you"}${manifest.author ? `, written by ${manifest.author}` : ""}.`,
                  (manifest.powers ?? []).length
                    ? `Elevated. It may use: ${(manifest.powers ?? []).map(p => POWER_LABEL[p].toLowerCase()).join(", ")}.`
                    : "Standard. It runs in a sandbox and can only use its own data.",
                ]}
              />
            )}
          </SettingsFace>
        }
      />
      {confirmOn && manifest && (() => {
        const w = widgetWarning(manifest, elevated);
        return <ConfirmDialog title={`Switch on ${manifest.name}?`} detail={w.detail} cancelLabel="Keep it off" confirmLabel="I trust it, switch it on" onCancel={() => setConfirmOn(false)} onConfirm={switchOn} />;
      })()}
    </>
  );
}
