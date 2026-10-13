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

// Fired on window when a write fails, so the page can tell the user instead of
// showing an edit that was never saved (detail: { key, reason }).
export const SAVE_FAILED_EVENT = "savefailed";

function reportSaveFailure(key: string, reason: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAVE_FAILED_EVENT, { detail: { key, reason } }));
  }
}

// Resolves true when the server stored the value. A rejection (too large,
// server down, network error) resolves false and raises SAVE_FAILED_EVENT;
// callers that must not continue after a failed write (migrations, deletes
// that depend on a copy) check the result.
export async function setItem(key: string, value: string): Promise<boolean> {
  if (isDemoMode()) { demoSetItem(key, value); return true; }
  try {
    const res = check401(
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
    );
    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    reportSaveFailure(key, typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
    return false;
  } catch {
    reportSaveFailure(key, "network error");
    return false;
  }
}

export async function removeItem(key: string): Promise<boolean> {
  if (isDemoMode()) { demoRemoveItem(key); return true; }
  try {
    const res = check401(
      await fetch(`/api/settings?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      })
    );
    return res.ok;
  } catch {
    return false;
  }
}
