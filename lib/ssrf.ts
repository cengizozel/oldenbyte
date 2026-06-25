// SSRF guard for the user-controlled URL fetcher (/api/proxy). Resolves the
// host and rejects any private / loopback / link-local / metadata / CGNAT
// address so an authenticated user cannot reach the LAN or cloud metadata.
// Node runtime only.
import { lookup } from "dns/promises";
import net from "net";

function isPrivateV4(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (incl. Tailscale)
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true; // loopback / unspecified
  if (x.startsWith("fe80")) return true; // link-local
  if (x.startsWith("fc") || x.startsWith("fd")) return true; // unique local
  if (x.startsWith("::ffff:")) return isPrivateV4(x.slice("::ffff:".length)); // v4-mapped
  return false;
}

function isBlocked(ip: string): boolean {
  return net.isIPv6(ip) ? isPrivateV6(ip) : isPrivateV4(ip);
}

// Validates the URL and that every resolved address is public. Returns the
// parsed URL on success, throws on any failure. Note: there is a small DNS
// rebinding TOCTOU window between this check and the actual fetch; acceptable
// for this deployment's threat model.
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }

  const host = url.hostname;
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    const resolved = await lookup(host, { all: true });
    addresses = resolved.map((r) => r.address);
  }
  if (addresses.length === 0) throw new Error("Host did not resolve");
  for (const addr of addresses) {
    if (isBlocked(addr)) throw new Error("URL resolves to a private address");
  }
  return url;
}

// SSRF-safe fetch: validates the initial URL and re-validates EVERY redirect
// hop against assertPublicUrl, so a public URL cannot 30x-redirect into a
// private/metadata address. Use this anywhere a user-controlled URL is fetched.
export async function safeFetch(
  rawUrl: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; maxRedirects?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, headers = {}, maxRedirects = 5 } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await assertPublicUrl(rawUrl);
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(url.toString(), { headers, redirect: "manual", signal });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (loc) {
      url = await assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
