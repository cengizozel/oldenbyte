// Node's fs, the few calls the server's code makes outside fs/promises
// (docs/app-bundle.md). Streams to and from files are a server's way of
// moving large uploads; on a device those routes are answered differently.
export * as promises from "./fsPromises";
export const existsSync = (): boolean => false;
export function createWriteStream(): never { throw new Error("Not on a device."); }
export function createReadStream(): never { throw new Error("Not on a device."); }
