// The server's guard on outgoing requests, on a device (docs/app-bundle.md).
// A server must not let an account reach the owner's private network through
// it. A device only ever reaches what its own owner asked for, from its own
// network, so there is nothing to guard: every request goes out as asked. The
// page's fetch is the app's own here (components/AppHost.tsx), free of the
// browser's cross-origin rule.
export const isBlocked = (): boolean => false;

export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https addresses can be fetched.");
  return url;
}

export async function safeFetch(
  rawUrl: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; maxRedirects?: number } = {},
): Promise<Response> {
  const url = await assertPublicUrl(rawUrl);
  return fetch(url.toString(), { headers: opts.headers ?? {}, signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
}

export async function fetchForUser(_user: { role: string }, rawUrl: string, init: RequestInit = {}): Promise<Response> {
  return fetch(rawUrl, init);
}

// A response body as text, read with a hard cap on its size.
export async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder().decode(bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes);
}
