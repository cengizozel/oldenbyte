import dns from "dns";
import { describe, expect, it, vi } from "vitest";
import { isBlocked, safeFetch } from "@/lib/ssrf";

// The pre-flight check (dns/promises) always sees a public address here, so
// the connect-time test below exercises the socket's own lookup.
vi.mock("dns/promises", async (orig) => ({
  ...(await orig<typeof import("dns/promises")>()),
  lookup: vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]),
}));

describe("isBlocked", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.50",
    "169.254.169.254", "100.100.1.1", "0.0.0.0", "224.0.0.1",
    "::1", "fe80::1", "fd7a:115c:a1e0::1", "::ffff:192.168.1.1",
    "198.18.0.1", "198.19.255.254", "192.0.0.8", "64:ff9b::c0a8:101", "2002:c0a8:101::1",
  ])("blocks private or special address %s", ip => {
    expect(isBlocked(ip)).toBe(true);
  });

  it.each(["1.1.1.1", "209.216.230.207", "172.32.0.1", "100.128.0.1", "2606:7100:1:67::26"])(
    "allows public address %s",
    ip => {
      expect(isBlocked(ip)).toBe(false);
    }
  );
});

describe("safeFetch connect-time pinning", () => {
  it("refuses a host that re-resolves to a private address after the check (DNS rebinding)", async () => {
    // The pre-flight check sees a public address (mock above); the socket's own
    // lookup then gets a private one, as a rebinding resolver would answer.
    const spy = vi.spyOn(dns, "lookup").mockImplementation(((
      _host: string,
      _opts: unknown,
      cb: (err: null, addrs: dns.LookupAddress[]) => void,
    ) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as unknown as typeof dns.lookup);
    const err = await safeFetch("http://rebind.example/", { timeoutMs: 3000 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as { cause?: { code?: string } }).cause?.code ?? err)).toMatch(/EBLOCKED|private address/);
    expect(spy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
