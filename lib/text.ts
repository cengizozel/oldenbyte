// Shared text helpers for server and client code. One entity decoder and one
// safe JSON parse, instead of a copy per widget or route.

const NAMED: Record<string, string> = {
  lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

// HTML/XML entities to text. `&amp;` is decoded last so an escaped entity
// ("&amp;lt;") comes out as the literal text "&lt;", not as "<".
export function decodeEntities(str: string): string {
  return str
    .replace(/&(lt|gt|quot|apos|nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo);/g, (_, name: string) => NAMED[name])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// JSON.parse that never throws: stored data can be missing, truncated, or from
// an older shape, and one bad value must not take a widget down.
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
