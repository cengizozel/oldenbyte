// Builds the interface as plain files, for packing into the apps
// (docs/app-bundle.md): node tools/app-bundle/build.mjs [out dir]
//
// It builds from a copy of the source, with Next.js set to write static
// files. The interface in the copy is the same code. What changes is where
// its answers come from: the server's routes are packed in as plain modules
// and run in the page (lib/appHost), on stand-ins for what only a server has
// (lib/appHost/device), which this script puts in place of the real ones.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = path.join(root, ".app-bundle");
const out = path.resolve(process.argv[2] ?? path.join(root, "app-bundle-out"));
const rel = p => path.relative(root, p).split(path.sep).join("/");

// Not part of the interface, or a server's alone.
const LEAVE_OUT = new Set([
  "node_modules", ".next", ".git", ".app-bundle", "app-bundle-out", "data", "tests", "docs", "tools",
  "app/api", "app/admin", "app/login", "app/embed", "app/manifest.ts", "proxy.ts", "instrumentation.ts", "next.config.ts",
]);

// Routes that only make sense with a server behind them: signing in and
// accounts, other devices, and the machine the server runs on.
// lib/appHost/localApi.ts answers the few of these the interface asks for on
// a device.
const SERVER_ONLY = [
  "auth", "setup", "register", "admin", "account", "me", "v1", "docker", "server-stats",
  "custom-widgets/media",
];

// The server's helpers that are swapped for a device's version.
const STAND_INS = ["prisma", "session", "ssrf", "requestUser", "password"];

// Node's own modules, as far as the packed code uses them.
const NODE = {
  fs: "fs", "fs/promises": "fsPromises", path: "path", crypto: "crypto",
  stream: "stream", busboy: "busboy", util: "absent", os: "absent", net: "absent", "node:net": "absent", dns: "absent", "dns/promises": "absent",
  "node:async_hooks": "absent", undici: "absent",
};

// Folders the server reads its shipped files from; they travel in the bundle.
const SHIPPED = ["widget-bank", "addons"];

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const keep = p => !LEAVE_OUT.has(rel(p));
for (const entry of readdirSync(root)) {
  const from = path.join(root, entry);
  if (keep(from)) cpSync(from, path.join(work, entry), { recursive: true, filter: keep });
}
symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"), "dir");

// The routes, outside app/ so Next.js does not take them for its own.
const api = path.join(root, "app", "api");
const serverOnly = p => SERVER_ONLY.some(s => rel(p) === `app/api/${s}` || rel(p).startsWith(`app/api/${s}/`));
cpSync(api, path.join(work, "deviceApi"), { recursive: true, filter: p => !serverOnly(p) });
const found = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name === "route.ts") found.push(path.relative(path.join(work, "deviceApi"), dir).split(path.sep).join("/"));
  }
})(path.join(work, "deviceApi"));
const entries = found.sort().map(route => {
  const names = [];
  const pattern = `/api/${route}`.split("/").map(part => {
    const m = /^\[(.+)\]$/.exec(part);
    if (m) { names.push(m[1]); return "([^/]+)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("\\/");
  return `  [/^${pattern}$/, ${JSON.stringify(names)}, () => import("@/deviceApi/${route}/route")],`;
});
writeFileSync(path.join(work, "lib", "appHost", "routes.ts"), `// Written by tools/app-bundle/build.mjs: the server's routes that run on a device.
import type { NextRequest } from "next/server";
export type RouteModule = Partial<Record<string, (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response>>;
export type Route = [pattern: RegExp, names: string[], load: () => Promise<RouteModule>];
export const routes: Route[] = [
${entries.join("\n")}
] as Route[];
`);

for (const name of STAND_INS) cpSync(path.join(root, "lib", "appHost", "device", `${name}.ts`), path.join(work, "lib", `${name}.ts`));

// What ships with oldenbyte and is read as files, with a list of it.
const shipped = [];
for (const dir of SHIPPED) {
  const from = path.join(root, dir);
  if (!existsSync(from)) continue;
  cpSync(from, path.join(work, "public", "_device", dir), { recursive: true });
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p); else shipped.push(`/${rel(p)}`);
    }
  })(from);
}
mkdirSync(path.join(work, "public", "_device"), { recursive: true });
writeFileSync(path.join(work, "public", "_device", "index.json"), JSON.stringify(shipped.sort()));

// Only where the code runs in a browser: the pages are also drawn once at
// build time, in Node, where the real modules are the right ones.
const alias = Object.fromEntries(Object.entries(NODE).map(([name, file]) => [name, { browser: `./lib/appHost/device/node/${file}.ts` }]));
writeFileSync(path.join(work, "next.config.ts"), `import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  trailingSlash: true,
  typescript: { ignoreBuildErrors: true },
  turbopack: { resolveAlias: ${JSON.stringify(alias, null, 2)} },
};
export default nextConfig;
`);
execFileSync("npx", ["next", "build"], { cwd: work, stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_OB_APP: "1" } });
if (!existsSync(path.join(work, "out", "index.html"))) throw new Error("The build wrote no index.html.");
rmSync(out, { recursive: true, force: true });
cpSync(path.join(work, "out"), out, { recursive: true });
rmSync(work, { recursive: true, force: true });
console.log(`The interface is in ${out}, with ${found.length} routes that run on a device.`);
