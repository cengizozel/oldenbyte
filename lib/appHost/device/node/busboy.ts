// The server reads uploads with busboy, piece by piece as they arrive
// (docs/app-bundle.md). On a device the upload is already whole, in the page:
// this reads it with the browser's own form parser and tells the same story
// to the route's code (a field, a file, the end), so that code runs as it is.
type Listener = (...args: unknown[]) => void;
class Emitter {
  private on_: Record<string, Listener[]> = {};
  on(name: string, fn: Listener) { (this.on_[name] ??= []).push(fn); return this; }
  emit(name: string, ...args: unknown[]) { for (const fn of this.on_[name] ?? []) fn(...args); }
}

// A phone's store holds a file as text, so there is a size past which an
// upload would only fail slowly. Larger files belong on a server.
const DEVICE_MAX = 20 * 1024 * 1024;

type Sink = { __write: (bytes: Uint8Array) => void };

class Parser extends Emitter {
  constructor(private opts: { headers: Record<string, string>; limits?: { fileSize?: number } }) { super(); }

  async __feed(body: ReadableStream | null) {
    try {
      const form = await new Response(body, { headers: { "content-type": this.opts.headers["content-type"] } }).formData();
      const limit = Math.min(this.opts.limits?.fileSize ?? Infinity, DEVICE_MAX);
      for (const [name, value] of form.entries()) {
        if (typeof value === "string") { this.emit("field", name, value); continue; }
        const bytes = new Uint8Array(await value.arrayBuffer());
        const stream = Object.assign(new Emitter(), {
          resume() {},
          pipe(this: Emitter, dest: Sink) {
            // After the route has set its listeners, as on a server.
            queueMicrotask(() => { if (bytes.length > limit) this.emit("limit"); else dest.__write(bytes); });
            return dest;
          },
        });
        this.emit("file", name, stream, { filename: value.name, mimeType: value.type, encoding: "7bit" });
      }
      this.emit("close");
    } catch (e) {
      this.emit("error", e);
    }
  }
}

export default function busboy(opts: { headers: Record<string, string>; limits?: { fileSize?: number } }) {
  return new Parser(opts);
}
