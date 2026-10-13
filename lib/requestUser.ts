import { AsyncLocalStorage } from "node:async_hooks";
import { fetchForUser } from "./ssrf";

// The signed-in user of the request being handled, for library code that
// fetches user-configured URLs (Kiwix, CalDAV, Anytype, feeds) without having
// the user passed through every call. A route opts in right after its auth
// check with `actAs(user)` (the rest of that request, including streams it
// starts, then sees the user), or wraps work in `runAsUser`. Libraries call
// userFetch instead of fetch; with no user set it applies the strict
// public-only check.
const store = new AsyncLocalStorage<{ role: string }>();

export function runAsUser<T>(user: { role: string }, fn: () => T): T {
  return store.run(user, fn);
}

export function actAs(user: { role: string }): void {
  store.enterWith(user);
}

export function userFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetchForUser(store.getStore() ?? { role: "user" }, url, init);
}
