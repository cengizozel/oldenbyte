import { describe, expect, it } from "vitest";
import { isBlocked } from "@/lib/ssrf";

describe("isBlocked", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.50",
    "169.254.169.254", "100.100.1.1", "0.0.0.0", "224.0.0.1",
    "::1", "fe80::1", "fd7a:115c:a1e0::1", "::ffff:192.168.1.1",
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
