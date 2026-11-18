// Node's path, the parts the server's code uses, for a device
// (docs/app-bundle.md). Posix style, like the server it was written for.
const clean = (p: string): string => {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else if (!abs) out.push(".."); }
    else out.push(part);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
};
export const sep = "/";
export const normalize = clean;
export const isAbsolute = (p: string) => p.startsWith("/");
export const join = (...parts: string[]) => clean(parts.filter(Boolean).join("/"));
export const resolve = (...parts: string[]) => {
  let out = "";
  for (const p of parts) out = p.startsWith("/") ? p : `${out}/${p}`;
  return clean(out.startsWith("/") ? out : `/${out}`);
};
export const dirname = (p: string) => { const c = clean(p); const i = c.lastIndexOf("/"); return i < 0 ? "." : i === 0 ? "/" : c.slice(0, i); };
export const basename = (p: string, ext?: string) => { const b = clean(p).split("/").pop() ?? ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p: string) => { const b = basename(p); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); };
export const relative = (from: string, to: string) => {
  const a = resolve(from).split("/").filter(Boolean), b = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
};
const path = { sep, normalize, isAbsolute, join, resolve, dirname, basename, extname, relative };
export default path;
