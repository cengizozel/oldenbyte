// Node's fs, the few calls the server's code makes outside fs/promises
// (docs/app-bundle.md). Streams to and from files are a server's way of
// moving large uploads; on a device those routes are answered differently.
import { writeFile } from "./fsPromises";
export * as promises from "./fsPromises";
export const existsSync = (): boolean => false;

type Listener = (arg?: unknown) => void;
class Emitter {
  private on_: Record<string, Listener[]> = {};
  on(name: string, fn: Listener) { (this.on_[name] ??= []).push(fn); return this; }
  emit(name: string, arg?: unknown) { for (const fn of this.on_[name] ?? []) fn(arg); }
}

// Writing a file as a stream: the whole of it arrives at once (see busboy.ts)
// and is kept like any other file.
export function createWriteStream(p: string) {
  let dropped = false;
  return Object.assign(new Emitter(), {
    destroy() { dropped = true; },
    __write(this: Emitter, bytes: Uint8Array) {
      if (dropped) return;
      writeFile(p, bytes).then(() => this.emit("finish"), e => this.emit("error", e));
    },
  });
}
export function createReadStream(): never { throw new Error("Not on a device."); }
