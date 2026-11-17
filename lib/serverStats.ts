import os from "os";
import path from "path";
import { readFile, readdir, statfs } from "fs/promises";

// What the machine running the dashboard is doing, for the Server widget.
// Inside Docker these are the HOST's processor and memory (/proc is not
// namespaced for them), and the disk is the one holding the data folder.

export type ServerStats = {
  cpu: number;            // percent busy across all cores since the last reading
  cores: number;
  load: number[];         // 1, 5 and 15 minute load averages
  mem: { used: number; total: number };
  disk: { used: number; total: number } | null;
  uptime: number;         // seconds
  temp: number | null;    // hottest sensor, in Celsius, when the system exposes one
};

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

// Busy share between two readings. Exported for tests.
export function busyPercent(a: { idle: number; total: number }, b: { idle: number; total: number }): number {
  const total = b.total - a.total;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - (b.idle - a.idle) / total) * 100));
}

// MemAvailable is what can be used without swapping; "free" alone counts
// cache as used and makes every Linux box look full. Exported for tests.
export function parseMeminfo(text: string): { used: number; total: number } | null {
  const kb = (key: string) => { const m = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m")); return m ? Number(m[1]) * 1024 : null; };
  const total = kb("MemTotal"), available = kb("MemAvailable");
  if (total === null || available === null) return null;
  return { used: total - available, total };
}

let last: { idle: number; total: number; at: number } | null = null;

async function cpuNow(): Promise<number> {
  const now = cpuTimes();
  // The first reading (or one after a long gap) has nothing recent to compare
  // with: take a short sample of its own.
  if (!last || Date.now() - last.at > 60_000) {
    await new Promise(r => setTimeout(r, 250));
    const later = cpuTimes();
    last = { ...later, at: Date.now() };
    return busyPercent(now, later);
  }
  const pct = busyPercent(last, now);
  last = { ...now, at: Date.now() };
  return pct;
}

async function memNow(): Promise<{ used: number; total: number }> {
  try {
    const parsed = parseMeminfo(await readFile("/proc/meminfo", "utf8"));
    if (parsed) return parsed;
  } catch {}
  return { used: os.totalmem() - os.freemem(), total: os.totalmem() };
}

// The folder the database lives in: on a self-hosted install that is the
// mounted data volume, so this is the disk your data is on.
function dataDir(): string {
  const url = process.env.DATABASE_URL ?? "file:prisma/dev.db";
  return path.dirname(path.resolve(url.replace(/^file:/, "")));
}

async function diskNow(): Promise<{ used: number; total: number } | null> {
  try {
    const s = await statfs(dataDir());
    const total = Number(s.blocks) * Number(s.bsize);
    if (!total) return null;
    return { used: total - Number(s.bavail) * Number(s.bsize), total };
  } catch { return null; }
}

async function tempNow(): Promise<number | null> {
  try {
    const zones = (await readdir("/sys/class/thermal")).filter(n => n.startsWith("thermal_zone"));
    const temps = await Promise.all(zones.map(async z => {
      try { return Number(await readFile(`/sys/class/thermal/${z}/temp`, "utf8")) / 1000; } catch { return NaN; }
    }));
    const ok = temps.filter(t => Number.isFinite(t) && t > 0 && t < 150);
    return ok.length ? Math.max(...ok) : null;
  } catch { return null; }
}

export async function readServerStats(): Promise<ServerStats> {
  const [cpu, mem, disk, temp] = await Promise.all([cpuNow(), memNow(), diskNow(), tempNow()]);
  return { cpu, cores: os.cpus().length, load: os.loadavg(), mem, disk, uptime: os.uptime(), temp };
}
