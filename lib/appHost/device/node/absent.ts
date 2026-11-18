// Node modules a device has no use for (docs/app-bundle.md): the code that
// imports them is a server's (sockets, DNS, stream plumbing, the form parser
// for uploads). They load as nothing, and fail plainly if ever called.
const absent = (): never => { throw new Error("Not on a device."); };
export const Readable = { fromWeb: absent, toWeb: absent, from: absent };
export const promisify = <T,>(fn: T): T => fn;
export const lookup = absent;
export const Agent = class { constructor() { absent(); } };
export const fetch = absent;
export const setDefaultAutoSelectFamilyAttemptTimeout = (): void => {};
export const isIP = (): number => 0;
export class AsyncLocalStorage<T> { private v: T | undefined; run<R>(v: T, fn: () => R): R { this.v = v; return fn(); } enterWith(v: T) { this.v = v; } getStore() { return this.v; } }
export const hostname = (): string => "device";
const all = { Readable, promisify, lookup, Agent, fetch, setDefaultAutoSelectFamilyAttemptTimeout, isIP, AsyncLocalStorage, hostname };
export default Object.assign(absent, all);
