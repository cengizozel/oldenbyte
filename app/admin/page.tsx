"use client";

import { useState, useEffect } from "react";
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
type Config = { registrationEnabled: boolean; hasInvite: boolean };

const cardClass =
  "bg-[var(--surface)] border border-[var(--surface-border)] rounded-2xl p-5 shadow-sm";
const inputClass =
  "text-sm border border-[var(--surface-border)] rounded-xl px-3 py-2 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-[var(--surface)]";

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
      className="inline-flex items-center gap-1.5 [font-family:var(--font-dm-mono)] text-xs bg-[var(--w-amber-bg)] border border-[var(--w-amber-border)] text-[var(--w-amber-text)] rounded-lg px-2 py-1 hover:opacity-80 transition-opacity"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
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
        <a href="/" className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          <ArrowLeft size={14} /> Back to dashboard
        </a>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--page-bg)] px-5 py-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-medium text-[var(--text-primary)] [font-family:var(--font-playfair)]">
            User management
          </h1>
          <a href="/" className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <ArrowLeft size={14} /> Dashboard
          </a>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm bg-[var(--w-rose-bg)] border border-[var(--w-rose-border)] text-[var(--w-rose-text)]">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Users */}
        <section className={cardClass}>
          <span className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Users</span>
          {!users ? (
            <div className="flex items-center gap-2 mt-3 text-sm text-[var(--text-muted)]">
              <Loader size={13} className="animate-spin" /> Loading…
            </div>
          ) : users.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--text-muted)]">No users.</p>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-[var(--surface-border)]">
              {users.map(u => (
                <div key={u.id} className="py-3 flex flex-col gap-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-[var(--text-primary)] truncate">{u.username}</span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md ${
                          u.role === "admin"
                            ? "bg-[var(--w-sky-bg)] border border-[var(--w-sky-border)] text-[var(--w-sky-label)]"
                            : "bg-[var(--w-neutral-bg)] border border-[var(--w-neutral-border)] text-[var(--w-neutral-label)]"
                        }`}
                      >
                        {u.role === "admin" && <ShieldCheck size={10} />}
                        {u.role}
                      </span>
                      {u.id === me.id && (
                        <span className="shrink-0 text-[10px] text-[var(--text-muted)]">you</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">{fmtDate(u.createdAt)}</span>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => resetPassword(u.id)}
                      disabled={busy === u.id}
                      className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-40 transition-colors"
                    >
                      {busy === u.id ? <Loader size={12} className="animate-spin" /> : <KeyRound size={12} />}
                      Reset password
                    </button>

                    {confirmDelete === u.id ? (
                      <span className="flex items-center gap-2 text-xs text-[var(--w-rose-label)]">
                        Delete?
                        <button onClick={() => deleteUser(u.id)} disabled={busy === u.id} className="underline hover:opacity-80 disabled:opacity-40">
                          Yes
                        </button>
                        <button onClick={() => setConfirmDelete(null)} className="underline hover:opacity-80">
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { setConfirmDelete(u.id); setError(""); }}
                        disabled={u.id === me.id}
                        title={u.id === me.id ? "You cannot delete your own account" : "Delete"}
                        className="flex items-center gap-1.5 text-xs text-[var(--w-rose-label)] hover:opacity-80 disabled:opacity-30 disabled:hover:opacity-30 transition-opacity"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </div>

                  {temps[u.id] && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <span>Temp password:</span>
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
          <span className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Registration</span>
          {!config ? (
            <div className="flex items-center gap-2 mt-3 text-sm text-[var(--text-muted)]">
              <Loader size={13} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)]">Allow new sign-ups</span>
                <button
                  onClick={toggleRegistration}
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${config.registrationEnabled ? "bg-[var(--text-muted)]" : "bg-[var(--surface-border-focus)]"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${config.registrationEnabled ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">Invite code</span>
                  <span className="text-xs text-[var(--text-muted)]">{config.hasInvite ? "Set" : "Not set"}</span>
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
                    placeholder={config.hasInvite ? "rotate invite code" : "set invite code"}
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    onClick={saveInvite}
                    disabled={!invite.trim()}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-[var(--surface-border)] text-[var(--text-primary)] hover:bg-[var(--surface-border-focus)] disabled:opacity-40 transition-colors"
                  >
                    <Check size={13} /> Save
                  </button>
                </div>
                {configMsg && <p className="text-xs text-[var(--text-muted)]">{configMsg}</p>}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
