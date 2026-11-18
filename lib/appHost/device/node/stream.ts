// Node's stream, the one call the server's code makes (docs/app-bundle.md):
// turning a request's body into something to pipe into the upload parser. On
// a device that parser reads the body itself (busboy.ts).
export const Readable = {
  fromWeb(body: ReadableStream | null) {
    return { pipe<T extends { __feed: (body: ReadableStream | null) => void }>(dest: T): T { dest.__feed(body); return dest; } };
  },
};
const stream = { Readable };
export default stream;
