"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Loader } from "lucide-react";
import { SettingsSection, SettingsRow } from "@/components/ui/Field";

// Settings > Your data: everything stored for this account, the way the user
// thinks of it (each dashboard's widgets, what is shared across dashboards,
// leftovers of removed widgets, caches), with sizes and last changes. Names
// and sizes only; /api/settings/summary never sends values.

type Group = { keys: number; bytes: number; updatedAt: number };
type Summary = {
  account: { username: string; createdAt: number; sessions: number } | null;
  dashboards: { id: string; name: string; widgets: (Group & { id: string; title: string; type: string })[] }[];
  shared: (Group & { label: string; detail: string })[];
  leftovers: Group & { widgets: number };
  caches: Group;
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function when(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const meta = (g: Group) => `${size(g.bytes)}${g.updatedAt ? ` · changed ${when(g.updatedAt)}` : ""}`;

export function DataSettings() {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false); // collapsed to its summary line by default

  useEffect(() => {
    fetch("/api/settings/summary")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const total = data
    ? [...data.shared, ...data.dashboards.flatMap(d => d.widgets), data.leftovers, data.caches].reduce((n, g) => n + g.bytes, 0)
    : 0;

  return (
    <SettingsSection title="Your data">
      {failed ? (
        <SettingsRow label="Could not load what is stored." />
      ) : !data ? (
        <SettingsRow label={<span className="flex items-center gap-2"><Loader size={14} className="animate-spin" /> Loading</span>} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            className="flex items-center justify-between gap-3 min-h-10 py-1.5 text-left"
          >
            <span className="min-w-0 flex flex-col">
              <span className="text-sm text-[var(--text-primary)]">{size(total)} stored for {data.account?.username ?? "you"}</span>
              {data.account && (
                <span className="text-sm text-[var(--text-muted)] leading-snug">
                  Account since {when(data.account.createdAt)} · {data.account.sessions} active {data.account.sessions === 1 ? "session" : "sessions"}
                </span>
              )}
            </span>
            <ChevronRight size={16} className={`shrink-0 text-[var(--text-muted)] transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
          {expanded && <>

          <p className="pt-3 pb-1 text-sm font-medium text-[var(--text-secondary)]">Shared by every dashboard</p>
          {data.shared.map(g => (
            <SettingsRow key={g.label} label={g.label} hint={[g.detail, meta(g)].filter(Boolean).join(" · ")} />
          ))}

          <p className="pt-3 pb-1 text-sm font-medium text-[var(--text-secondary)]">Dashboards</p>
          {data.dashboards.map(d => {
            const sum = d.widgets.reduce((n, w) => n + w.bytes, 0);
            const isOpen = open === d.id;
            return (
              <div key={d.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : d.id)}
                  aria-expanded={isOpen}
                  className="flex items-center justify-between gap-3 min-h-10 py-1.5 text-left"
                >
                  <span className="min-w-0 flex flex-col">
                    <span className="text-sm text-[var(--text-primary)] truncate">{d.name}</span>
                    <span className="text-sm text-[var(--text-muted)]">{d.widgets.length} {d.widgets.length === 1 ? "widget" : "widgets"} with data · {size(sum)}</span>
                  </span>
                  <ChevronRight size={16} className={`shrink-0 text-[var(--text-muted)] transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
                {isOpen && (
                  <ul className="mb-2 ml-1 pl-3 border-l border-[var(--surface-border)] flex flex-col">
                    {d.widgets.length === 0 && <li className="py-1 text-sm text-[var(--text-muted)]">No saved data yet.</li>}
                    {d.widgets.map(w => (
                      <li key={w.id} className="py-1.5 flex flex-col">
                        <span className="text-sm text-[var(--text-primary)] truncate">{w.title} <span className="text-[var(--text-muted)]">{w.type}</span></span>
                        <span className="text-sm text-[var(--text-muted)]">{meta(w)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          <p className="pt-3 pb-1 text-sm font-medium text-[var(--text-secondary)]">Other</p>
          <SettingsRow
            label="Left by removed widgets"
            hint={data.leftovers.keys ? `${data.leftovers.widgets} ${data.leftovers.widgets === 1 ? "widget" : "widgets"} · ${meta(data.leftovers)} · clear it from the edit shelf` : "Nothing"}
          />
          <SettingsRow label="Caches" hint={data.caches.keys ? `${meta(data.caches)} · feeds and lookups, removed on their own` : "Nothing"} />
          </>}
        </>
      )}
    </SettingsSection>
  );
}
