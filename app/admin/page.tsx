"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Toggle from "@/components/ui/Toggle";
import { FOCUS_RING } from "@/components/ui/Field";
import {
  Loader, ArrowLeft, KeyRound, Trash2, Copy, Check, ShieldCheck, AlertTriangle,
} from "lucide-react";

type Me = { id: string; username: string; role: string; mustChangePassword: boolean };
type AdminUser = {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  createdAt: string;
};
type Config = { registrationEnabled: boolean; hasInvite: boolean; feedCacheMinutes: number };

const cardClass =
  "bg-[var(--surface)] border border-[var(--surface-border)] rounded-2xl p-5 shadow-sm";
const inputClass =
  "text-sm h-10 border border-[var(--surface-border)] rounded-xl px-3 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-[var(--surface)]";

// The same hierarchy as a widget's settings face: a section title, labels in
// the primary color, hints one step quieter, nothing below 14px.
const SECTION_TITLE = "text-base font-semibold text-[var(--text-primary)]";
const LABEL = "text-sm font-medium text-[var(--text-primary)]";
const HINT = "text-sm text-[var(--text-secondary)]";
const SECONDARY_BUTTON = "bg-black/5 dark:bg-white/10 text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/15 transition-colors";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      className="inline-flex items-center gap-1.5 font-mono text-sm bg-[var(--w-amber-bg)] border border-[var(--w-amber-border)] text-[var(--w-amber-text)] rounded-lg px-2 py-1 hover:opacity-80 transition-opacity"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{value}</span>
    </button>
  );
}

export default function AdminPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");

  const [temps, setTemps] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [invite, setInvite] = useState("");
  const [configMsg, setConfigMsg] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then(res => (res.ok ? res.json() : null))
      .then((data: Me | null) => setMe(data))
      .catch(() => {})
      .finally(() => setMeLoaded(true));
  }, []);

  useEffect(() => {
    if (!me || me.role !== "admin") return;
    loadUsers();
    loadConfig();
  }, [me]);

  async function loadUsers() {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(data.users);
    } catch {
      setError("Could not load users.");
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/admin/config");
      if (!res.ok) throw new Error();
      setConfig(await res.json());
    } catch {
      setError("Could not load settings.");
    }
  }

  async function resetPassword(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resetPassword" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.tempPassword) {
        setError(data?.error || "Could not reset password.");
        return;
      }
      setTemps(t => ({ ...t, [id]: data.tempPassword }));
      setUsers(us => us?.map(u => (u.id === id ? { ...u, mustChangePassword: true } : u)) ?? us);
    } catch {
      setError("Could not reset password.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteUser(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Could not delete user.");
        return;
      }
      setUsers(us => us?.filter(u => u.id !== id) ?? us);
      setTemps(t => { const n = { ...t }; delete n[id]; return n; });
    } catch {
      setError("Could not delete user.");
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  }

  async function toggleRegistration() {
    if (!config) return;
    const value = !config.registrationEnabled;
    setConfig(c => (c ? { ...c, registrationEnabled: value } : c));
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationEnabled: value }),
      });
      if (!res.ok) throw new Error();
      setConfig(await res.json());
    } catch {
      setConfig(c => (c ? { ...c, registrationEnabled: !value } : c));
      setConfigMsg("Could not update.");
    }
  }

  async function saveFeedCache(minutes: number) {
    if (!config || !Number.isFinite(minutes) || minutes < 1) return;
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedCacheMinutes: minutes }),
      });
      if (!res.ok) throw new Error();
      setConfig(await res.json());
      setConfigMsg("Feed cache updated.");
    } catch {
      setConfigMsg("Could not update feed cache.");
    }
  }

  async function saveInvite() {
    setConfigMsg("");
    if (!invite.trim()) return;
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: invite.trim() }),
      });
      if (!res.ok) throw new Error();
      setConfig(await res.json());
      setInvite("");
      setConfigMsg("Invite code saved.");
    } catch {
      setConfigMsg("Could not save invite code.");
    }
  }

  if (!meLoaded) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--page-bg)]">
        <Loader size={18} className="animate-spin text-[var(--text-muted)]" />
      </main>
    );
  }

  if (!me || me.role !== "admin") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[var(--page-bg)]">
        <p className="text-sm text-[var(--text-secondary)]">Not authorized.</p>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--page-bg)] px-5 py-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">User management</h1>
          <Link href="/" className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm ${SECONDARY_BUTTON} ${FOCUS_RING}`}>
            <ArrowLeft size={16} /> Dashboard
          </Link>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm bg-[var(--w-rose-bg)] border border-[var(--w-rose-border)] text-[var(--w-rose-text)]">
            <AlertTriangle size={16} className="shrink-0" /> {error}
          </div>
        )}

        {/* Users */}
        <section className={cardClass}>
          <h2 className={SECTION_TITLE}>Users</h2>
          {!users ? (
            <div className={`flex items-center gap-2 mt-4 ${HINT}`}>
              <Loader size={16} className="animate-spin" /> Loading
            </div>
          ) : users.length === 0 ? (
            <p className={`mt-4 ${HINT}`}>No users.</p>
          ) : (
            <div className="mt-4 flex flex-col divide-y divide-[var(--surface-border)]">
              {users.map(u => (
                <div key={u.id} className="py-4 flex flex-col gap-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-base font-medium text-[var(--text-primary)] truncate">{u.username}</span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded-md ${
                          u.role === "admin"
                            ? "bg-[var(--w-sky-bg)] border border-[var(--w-sky-border)] text-[var(--w-sky-text)]"
                            : "bg-[var(--w-neutral-bg)] border border-[var(--w-neutral-border)] text-[var(--w-neutral-text)]"
                        }`}
                      >
                        {u.role === "admin" && <ShieldCheck size={14} />}
                        {u.role === "admin" ? "Admin" : "User"}
                      </span>
                      {u.id === me.id && <span className={`shrink-0 ${HINT}`}>you</span>}
                    </div>
                    <span className={`shrink-0 ${HINT}`} title="Joined">{fmtDate(u.createdAt)}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => resetPassword(u.id)}
                      disabled={busy === u.id}
                      className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm ${SECONDARY_BUTTON} disabled:opacity-40 ${FOCUS_RING}`}
                    >
                      {busy === u.id ? <Loader size={14} className="animate-spin" /> : <KeyRound size={14} />}
                      Reset password
                    </button>

                    {confirmDelete === u.id ? (
                      <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        Delete {u.username} and their data?
                        <button onClick={() => deleteUser(u.id)} disabled={busy === u.id} className={`h-8 px-3 rounded-lg text-sm font-medium bg-black/10 dark:bg-white/15 text-red-600 dark:text-red-400 hover:bg-black/15 dark:hover:bg-white/20 disabled:opacity-40 ${FOCUS_RING}`}>
                          Delete
                        </button>
                        <button onClick={() => setConfirmDelete(null)} className={`h-8 px-3 rounded-lg text-sm ${SECONDARY_BUTTON} ${FOCUS_RING}`}>
                          Keep
                        </button>
                      </span>
                    ) : u.id !== me.id && (
                      <button
                        onClick={() => { setConfirmDelete(u.id); setError(""); }}
                        className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm bg-black/5 dark:bg-white/10 text-red-600 dark:text-red-400 hover:bg-black/10 dark:hover:bg-white/15 ${FOCUS_RING}`}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>

                  {temps[u.id] && (
                    <div className="flex items-center gap-2 flex-wrap text-sm text-[var(--text-secondary)]">
                      <span>Temporary password</span>
                      <CopyBox value={temps[u.id]} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Registration */}
        <section className={cardClass}>
          <h2 className={SECTION_TITLE}>Registration</h2>
          {!config ? (
            <div className={`flex items-center gap-2 mt-4 ${HINT}`}>
              <Loader size={16} className="animate-spin" /> Loading
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className={LABEL}>Allow new sign-ups</span>
                  <span className={HINT}>Anyone with the invite code can create an account.</span>
                </div>
                <Toggle checked={config.registrationEnabled} onChange={toggleRegistration} label="Allow new sign-ups" />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className={LABEL}>Invite code</span>
                  <span className={HINT}>{config.hasInvite ? "Set" : "Not set"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={invite}
                    onChange={e => setInvite(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveInvite()}
                    placeholder={config.hasInvite ? "New invite code" : "Invite code"}
                    aria-label="Invite code"
                    className={`${inputClass} flex-1 min-w-0`}
                  />
                  <button
                    onClick={saveInvite}
                    disabled={!invite.trim()}
                    className={`shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-medium bg-black/10 dark:bg-white/15 text-[var(--text-primary)] hover:bg-black/15 dark:hover:bg-white/20 disabled:opacity-40 ${FOCUS_RING}`}
                  >
                    <Check size={16} /> Save
                  </button>
                </div>
                {configMsg && <p className={HINT}>{configMsg}</p>}
              </div>
            </div>
          )}
        </section>

        {/* Server */}
        {config && (
          <section className={cardClass}>
            <h2 className={SECTION_TITLE}>Server</h2>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className={LABEL}>Feed cache</span>
                <span className={HINT}>How long feeds (RSS, Reddit, YouTube, HF, arXiv) are served from the server cache before refetching. Widgets can still force a refresh.</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={config.feedCacheMinutes}
                  aria-label="Feed cache in minutes"
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    setConfig(c => (c ? { ...c, feedCacheMinutes: Number.isFinite(v) ? v : c.feedCacheMinutes } : c));
                  }}
                  onBlur={e => saveFeedCache(parseInt(e.target.value))}
                  onKeyDown={e => e.key === "Enter" && saveFeedCache(parseInt((e.target as HTMLInputElement).value))}
                  className={`${inputClass} w-20 text-center tabular-nums`}
                />
                <span className="text-sm text-[var(--text-secondary)]">min</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
