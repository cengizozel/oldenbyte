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
  if (isDemoMode()) return demoGetItem(key);
  try {
    const res = check401(await fetch(`/api/settings?key=${encodeURIComponent(key)}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch {
    return null;
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
