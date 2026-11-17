"use client";

import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import { FOCUS_RING, SettingsRow, SettingsSection } from "@/components/ui/Field";

// Settings > Devices: the apps signed in to this account (the phone app, and
// anything else using a device token), with a way to sign each one out, for a
// phone that is lost or sold. Browsers are not listed: they sign in with a
// session, ended by signing out there or by changing the password.

type Device = { id: string; name: string; createdAt: string; lastUsedAt: string; current: boolean };

export function DevicesSettings() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/devices");
      if (!res.ok) throw new Error();
      setDevices((await res.json()).devices ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function signOut(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error();
      setDevices(list => (list ?? []).filter(d => d.id !== id));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection title="Devices">
      {failed ? (
        <SettingsRow label="Could not load your devices." />
      ) : devices === null ? (
        <SettingsRow label="Loading" />
      ) : devices.length === 0 ? (
        <SettingsRow label="No apps are signed in" hint="An app that signs in to this account, like the phone app, appears here." />
      ) : (
        devices.map(d => (
          <SettingsRow key={d.id} label={d.name} hint={`Last used ${timeAgo(d.lastUsedAt)} · signed in ${timeAgo(d.createdAt)}`}>
            <button
              type="button"
              onClick={() => signOut(d.id)}
              disabled={busy === d.id}
              aria-label={`Sign out ${d.name}`}
              className={`h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[var(--text-primary)] disabled:opacity-40 transition-colors ${FOCUS_RING}`}
            >
              Sign out
            </button>
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}
