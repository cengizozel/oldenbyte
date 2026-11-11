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
    rememberVersion(key, data.version);
    return { ok: true, value: data.value ?? null };
  } catch {
    return { ok: false, value: null };
  }
}

// The server counts writes per key and tells us the count on every read and
// successful write. A write sends the count it last saw, and the server
// refuses it (409) if the key moved on since: another tab, another device or
// the config API saved in between. The stale count is kept after a conflict,
// so every further save from this page fails the same way until it reloads,
// instead of the page winning on its second try and quietly undoing the other
// save. Keys this page never read are written unconditionally.
const versions = new Map<string, number>();

function rememberVersion(key: string, version: unknown) {
  if (typeof version === "number") versions.set(key, version);
  else versions.delete(key);
}

// Fired on window when a write fails, so the page can tell the user instead of
// showing an edit that was never saved (detail: { key, reason }).
export const SAVE_FAILED_EVENT = "savefailed";

function reportSaveFailure(key: string, reason: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAVE_FAILED_EVENT, { detail: { key, reason } }));
  }
}

// Fired on window whenever the number of writes not yet confirmed by the
// server changes (detail: { pending }), so the page can show "Saving..." and
// warn before a reload throws a write away.
export const SAVE_STATE_EVENT = "savestate";

// Writes to the same key go out one at a time and the newest value wins: a
// burst of changes (dragging widgets around in edit mode saves the layout on
// every move) used to fire overlapping requests that could land out of order,
// so an older layout overwrote the newer one. While a write is in flight only
// the latest waiting value is kept, and every caller in between resolves with
// the result of the write that superseded theirs.
type Slot = { running: Promise<boolean>; next?: { value: string; waiters: ((ok: boolean) => void)[] } };
const slots = new Map<string, Slot>();
let pending = 0;

function setPending(delta: number) {
  pending += delta;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAVE_STATE_EVENT, { detail: { pending } }));
  }
}

export function pendingSaves(): number {
  return pending;
}

// Browsers cap the bytes of all keepalive requests in flight at 64 KB and
// reject any request past that outright, so keepalive is only used while the
// running total stays under the cap (a page load writes several keys at once).
const KEEPALIVE_BUDGET = 60_000;
let keepaliveInFlight = 0;
const GATEWAY_DOWN = new Set([502, 503, 504]);
const RESTART_RETRIES = [1000, 2000, 4000, 8000, 15000];

async function post(body: string, keepalive: boolean): Promise<Response> {
  return check401(
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive,
    })
  );
}

async function send(key: string, value: string): Promise<boolean> {
  const version = versions.get(key);
  const body = JSON.stringify(version === undefined ? { key, value } : { key, value, version });
  // Small writes may finish even if the page is reloaded or closed meanwhile.
  const keepalive = keepaliveInFlight + body.length < KEEPALIVE_BUDGET;
  if (keepalive) keepaliveInFlight += body.length;
  try {
    let res: Response | null;
    try {
      res = await post(body, keepalive);
    } catch {
      // A keepalive rejection is the browser's quota, not the network: retry
      // once as a normal request before calling it a failure.
      res = keepalive ? await post(body, false).catch(() => null) : null;
    }
    // While the app restarts (a deploy takes a few seconds) the proxy answers
    // 502/503/504 or the connection fails. The write never reached the app,
    // so it is safe to send again: retry for about half a minute before
    // reporting a failure.
    for (const wait of RESTART_RETRIES) {
      if (res && !GATEWAY_DOWN.has(res.status)) break;
      await new Promise(r => setTimeout(r, wait));
      res = await post(body, false).catch(() => null);
    }
    if (!res) throw new Error("network");
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (typeof data.version === "number") versions.set(key, data.version);
      return true;
    }
    reportSaveFailure(key, typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
    return false;
  } catch {
    reportSaveFailure(key, "network error");
    return false;
  } finally {
    if (keepalive) keepaliveInFlight -= body.length;
  }
}

function start(key: string, value: string): Promise<boolean> {
  setPending(1);
  const running = send(key, value).finally(() => setPending(-1));
  const slot: Slot = { running };
  slots.set(key, slot);
  running.then(() => {
    const next = slot.next;
    if (next) {
      const after = start(key, next.value);
      after.then(ok => next.waiters.forEach(w => w(ok)));
    } else if (slots.get(key) === slot) {
      slots.delete(key);
    }
  });
  return running;
}

// Resolves true when the server stored the value (or a newer value written to
// the same key right after it). A rejection (too large, server down, network
// error) resolves false and raises SAVE_FAILED_EVENT; callers that must not
// continue after a failed write (migrations, deletes that depend on a copy)
// check the result.
export function setItem(key: string, value: string): Promise<boolean> {
  if (isDemoMode()) { demoSetItem(key, value); return Promise.resolve(true); }
  const slot = slots.get(key);
  if (!slot) return start(key, value);
  return new Promise<boolean>(resolve => {
    if (slot.next) slot.next.value = value;
    else { slot.next = { value, waiters: [] }; setPending(1); slot.running.finally(() => setPending(-1)); }
    slot.next.waiters.push(resolve);
  });
}

export async function removeItem(key: string): Promise<boolean> {
  if (isDemoMode()) { demoRemoveItem(key); return true; }
  versions.delete(key);
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
