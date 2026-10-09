import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// Node gives each address family 250 ms to connect before trying the next.
// A far-away host with both IPv4 and IPv6 (Hacker News, seen from a server
// without working IPv6) needs longer than that over IPv4, so every attempt
// failed. 2 s lets the slow-but-working address finish. Node runtime only:
// instrumentation.ts imports this behind its NEXT_RUNTIME check.
export function widenHappyEyeballs() {
  setDefaultAutoSelectFamilyAttemptTimeout(2000);
}
