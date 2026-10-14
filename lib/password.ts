// Password hashing with scrypt from Node's built-in crypto — no external deps.
// Node runtime only (do not import from Edge middleware).
import { randomBytes, scrypt as _scrypt, timingSafeEqual, type ScryptOptions } from "crypto";
import { promisify } from "util";

// promisify loses the options overload in its types; restore it explicitly.
const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

// At most this many scrypt computations run at once (each takes ~16MB and a
// libuv thread); extra callers wait their turn instead of piling up.
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const N = 65536; // CPU/memory cost (2^16), about 64MB per hash
const R = 8;
const P = 1;
const KEYLEN = 64;

// scrypt needs about 128 * N * r bytes; Node refuses above 32MB unless told.
function scryptMem(n: number, r: number): number {
  return 128 * n * r * 2;
}

// True for hashes made with weaker parameters than the current ones, so login
// can upgrade them in place once the password is known to be correct.
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  return parts[0] !== "scrypt" || Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await limited(() =>
    scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: scryptMem(N, R) })
  )) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
    if (!n || !r || !p || salt.length === 0 || expected.length === 0) return false;
    const derived = (await limited(() =>
      scrypt(password, salt, expected.length, { N: n, r, p, maxmem: scryptMem(n, r) })
    )) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
