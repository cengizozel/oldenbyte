import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { assertPublicUrl } from "@/lib/ssrf";

const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

// Follow redirects manually so EACH hop's destination is re-checked by the SSRF
// guard — otherwise a public URL could 30x-redirect to a private/metadata
// address and bypass the initial check.
async function safeFetch(initial: URL, signal: AbortSignal): Promise<Response> {
  let url = initial;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "curl/7.68.0" },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, url);
      url = await assertPublicUrl(next.toString()); // throws if the hop is private
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "Invalid or disallowed URL" }, { status: 400 });

  let url: URL;
  try {
    url = await assertPublicUrl(raw);
  } catch {
    return NextResponse.json({ error: "Invalid or disallowed URL" }, { status: 400 });
  }

  try {
    const res = await safeFetch(url, AbortSignal.timeout(8000));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Stream with a hard cap so a huge response cannot exhaust memory.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (received >= MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }
    const merged = new Uint8Array(Math.min(received, MAX_BYTES));
    let offset = 0;
    for (const c of chunks) {
      if (offset >= merged.length) break;
      const slice = c.subarray(0, merged.length - offset);
      merged.set(slice, offset);
      offset += slice.length;
    }
    const text = new TextDecoder().decode(merged).trim();
    return new NextResponse(text, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
