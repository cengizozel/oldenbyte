import { isDemoMode, demoGetItem, demoSetItem, demoRemoveItem } from "@/lib/demo";

// All persistence funnels through here. In demo mode every read and write is
// redirected to an in-memory copy of the first-run seed (lib/demo), so the
// server never sees demo traffic.

// If the session was revoked server-side, the API answers 401; bounce to login.
function check401(res: Response): Response {
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  return res;
}

export async function getItem(key: string): Promise<string | null> {
  return (await getItemResult(key)).value;
}

// Like getItem, but reports whether the read actually SUCCEEDED. `getItem`
// returns null both for a genuinely-absent key and for a failed request (server
// restarting mid-deploy, network blip, 401). Callers that would otherwise treat
// null as "no data yet" and then overwrite storage with a default MUST use this
// and skip the write when `ok` is false — otherwise a transient read failure
// silently clobbers real data (e.g. resets the dashboard to the seed).
export async function getItemResult(key: string): Promise<{ ok: boolean; value: string | null }> {
  if (isDemoMode()) return { ok: true, value: demoGetItem(key) };
  try {
    const res = check401(await fetch(`/api/settings?key=${encodeURIComponent(key)}`));
    if (!res.ok) return { ok: false, value: null };
    const data = await res.json();
    return { ok: true, value: data.value ?? null };
  } catch {
    return { ok: false, value: null };
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isDemoMode()) return demoSetItem(key, value);
  try {
    check401(
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
    );
  } catch {}
}

export async function removeItem(key: string): Promise<void> {
  if (isDemoMode()) return demoRemoveItem(key);
  try {
    check401(
      await fetch(`/api/settings?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      })
    );
  } catch {}
}
