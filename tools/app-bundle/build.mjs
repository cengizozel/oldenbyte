// Builds the interface as plain files, for packing into the apps
// (docs/app-bundle.md): node tools/app-bundle/build.mjs [out dir]
//
// It builds from a copy of the source that leaves out everything that only a
// server has (the API routes, the sign-in pages, the request gate), with
// Next.js set to write static files. The interface in the copy is the same
// code; it only gets its answers from somewhere else (lib/appHost).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = path.join(root, ".app-bundle");
const out = path.resolve(process.argv[2] ?? path.join(root, "app-bundle-out"));

const LEAVE_OUT = new Set([
  "node_modules", ".next", ".git", ".app-bundle", "app-bundle-out", "data", "tests", "docs", "tools",
  "app/api", "app/admin", "app/login", "app/embed", "app/manifest.ts", "proxy.ts", "instrumentation.ts", "next.config.ts",
]);

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const keep = p => !LEAVE_OUT.has(path.relative(root, p).split(path.sep).join("/"));
for (const entry of readdirSync(root)) {
  const from = path.join(root, entry);
  if (keep(from)) cpSync(from, path.join(work, entry), { recursive: true, filter: keep });
}
symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"), "dir");
writeFileSync(path.join(work, "next.config.ts"), `import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  trailingSlash: true,
};
export default nextConfig;
`);
execFileSync("npx", ["next", "build"], { cwd: work, stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_OB_APP: "1" } });
if (!existsSync(path.join(work, "out", "index.html"))) throw new Error("The build wrote no index.html.");
rmSync(out, { recursive: true, force: true });
cpSync(path.join(work, "out"), out, { recursive: true });
rmSync(work, { recursive: true, force: true });
console.log(`The interface is in ${out}.`);
