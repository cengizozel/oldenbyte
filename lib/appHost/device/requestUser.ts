// On a device every request is the owner's (docs/app-bundle.md), so there is
// no user to carry along: the helpers the server's code calls do nothing more
// than run the work and fetch.
export function runAsUser<T>(_user: { role: string }, fn: () => T): T {
  return fn();
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function actAs(_user: { role: string }): void {}
export function userFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}
