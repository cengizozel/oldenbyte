"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, RefreshCw } from "lucide-react";
import type { Widget } from "@/lib/widgets";
import { FOCUS_RING } from "@/components/ui/Field";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { MAX_WIDGET_BYTES, POWER_LABEL, extId, parseWidgetFile, type CustomManifest, type Power } from "@/lib/customWidgets";
import { installCatalogWidget, uploadCustomWidget, useCustomWidgets } from "@/lib/useCustomWidgets";
import { widgetWarning } from "@/components/CustomWidget";

// The picker's parts for custom widgets (docs/custom-widgets.md): uploading a
// widget file, and the community catalog with its install button. Every
// install passes the warning first.

const BUTTON = `h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-50 ${FOCUS_RING}`;

type Pending = { manifest: CustomManifest; run: () => Promise<{ ok: true } | { ok: false; error: string }> };

function useInstall() {
  const { elevated } = useCustomWidgets();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const dialog = pending ? (() => {
    const w = widgetWarning(pending.manifest, elevated);
    return (
      <ConfirmDialog
        title={w.title}
        detail={w.detail}
        cancelLabel="Cancel"
        confirmLabel={w.confirm}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const job = pending;
          setPending(null);
          setBusy(true);
          const res = await job.run();
          setBusy(false);
          setMessage(res.ok
            ? { text: w.startsOff ? `${job.manifest.name} added, switched off. Switch it on in Settings, Custom widgets.` : `${job.manifest.name} added.`, bad: false }
            : { text: res.error, bad: true });
        }}
      />
    );
  })() : null;
  return { ask: setPending, busy, message, setMessage, dialog };
}

function Message({ message }: { message: { text: string; bad: boolean } | null }) {
  if (!message) return null;
  return <p role="status" className={`text-sm leading-snug ${message.bad ? "text-red-500" : "text-[var(--text-secondary)]"}`}>{message.text}</p>;
}

// "Upload a widget file": reads the file here first, so a file that is not a
// widget is refused with its reasons before anything is sent.
export function UploadWidget() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { ask, busy, message, setMessage, dialog } = useInstall();

  async function onFile(file: File) {
    setMessage(null);
    if (file.size > MAX_WIDGET_BYTES) { setMessage({ text: `That file is larger than ${Math.round(MAX_WIDGET_BYTES / 1000)} KB.`, bad: true }); return; }
    const html = await file.text();
    const parsed = parseWidgetFile(html);
    if (!parsed.manifest) { setMessage({ text: `Not a widget file: ${parsed.errors.slice(0, 3).join("; ")}.`, bad: true }); return; }
    ask({ manifest: parsed.manifest, run: () => uploadCustomWidget(html) });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={`${BUTTON} self-start flex items-center gap-1.5`}>
        <Upload size={14} /> {busy ? "Adding..." : "Upload a widget file"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".html,text/html"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <Message message={message} />
      {dialog}
    </div>
  );
}

type Entry = { id: string; name: string; description: string; version: string; author?: string; powers: Power[]; reviewed: boolean; color?: CustomManifest["color"] };

const newer = (a: string, b: string) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

// The community catalog: what is listed, what is installed, what has a newer
// version. Listed is not the same as trusted, so the same warnings apply.
export function CommunityCatalog({ query, templates, onAdd }: { query: string; templates: Widget[]; onAdd: (template: Widget) => void }) {
  const { widgets: installed } = useCustomWidgets();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off" | "failed">("loading");
  const { ask, busy, message, dialog } = useInstall();

  function load(refresh: boolean) {
    setState("loading");
    fetch(`/api/custom-widgets/catalog${refresh ? "?refresh=1" : ""}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { widgets?: Entry[]; off?: boolean }) => {
        setEntries(Array.isArray(d.widgets) ? d.widgets : []);
        setState(d.off ? "off" : "ok");
      })
      .catch(() => setState("failed"));
  }
  useEffect(() => {
    let stale = false;
    fetch("/api/custom-widgets/catalog")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { widgets?: Entry[]; off?: boolean }) => {
        if (stale) return;
        setEntries(Array.isArray(d.widgets) ? d.widgets : []);
        setState(d.off ? "off" : "ok");
      })
      .catch(() => { if (!stale) setState("failed"); });
    return () => { stale = true; };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (entries ?? [])
    .filter(e => !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || (e.author ?? "").toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm text-[var(--text-muted)] leading-snug">
          Widgets written by other people. Listed does not mean checked: read what each one asks for.
        </p>
        <button type="button" onClick={() => load(true)} title="Reload the catalog" aria-label="Reload the catalog" className={`shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] ${FOCUS_RING}`}>
          <RefreshCw size={14} className={state === "loading" ? "animate-spin" : ""} />
        </button>
      </div>
      <Message message={message} />
      {state === "off" && <p className="text-sm text-[var(--text-muted)]">The catalog is turned off on this server.</p>}
      {state === "failed" && <p className="text-sm text-[var(--text-muted)]">The catalog could not be loaded. The server may be offline.</p>}
      {state === "ok" && shown.length === 0 && <p className="text-sm text-[var(--text-muted)]">{q ? "No widgets match." : "The catalog is empty."}</p>}
      <ul className="flex flex-col gap-1.5">
        {shown.map(e => {
          const have = installed.find(w => w.ext === extId("community", e.id));
          const update = !!have && newer(e.version, have.manifest.version);
          const template = templates.find(t => t.ext === extId("community", e.id));
          const manifest: CustomManifest = { format: 1, id: e.id, name: e.name, description: e.description, version: e.version, author: e.author, powers: e.powers };
          return (
            <li key={e.id} className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-2 flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{e.name}</span>
                <span className="text-sm text-[var(--text-muted)] tabular-nums shrink-0">{e.version}</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-snug">{e.description}</p>
              <p className="text-sm text-[var(--text-muted)] leading-snug">
                {[e.author ? `by ${e.author}` : "", e.reviewed ? "reviewed" : "not reviewed", e.powers.length ? `elevated: ${e.powers.map(p => POWER_LABEL[p].toLowerCase()).join(", ")}` : "standard"].filter(Boolean).join(" · ")}
              </p>
              <div className="flex items-center justify-end gap-1.5">
                {have && !update && <span className="mr-auto text-sm text-[var(--text-muted)]">Installed</span>}
                {update && <span className="mr-auto text-sm text-[var(--text-muted)]">Update to {e.version}</span>}
                {have && template && <button type="button" onClick={() => onAdd(template)} className={BUTTON}>Add to dashboard</button>}
                {(!have || update) && (
                  <button type="button" disabled={busy} onClick={() => ask({ manifest, run: () => installCatalogWidget(e.id) })} className={BUTTON}>
                    {update ? "Update" : "Install"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {dialog}
    </div>
  );
}
