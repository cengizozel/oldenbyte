// Client for the Anytype write bridge (tools/anytype-bridge): the tiny HTTP
// service that runs next to the Anytype desktop app and forwards block-level
// writes to anytype-heart's gRPC API. Reads for search/lookup keep using the
// regular Anytype local HTTP API (lib/anytype.ts); the bridge only adds what
// that API cannot do: styled block writes and the space style profile.

export type BridgeConfig = { url: string; token: string };

export async function bridgeRpc<T = Record<string, unknown>>(
  bridge: BridgeConfig,
  op: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${bridge.url.trim().replace(/\/+$/, "")}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bridge.token}`,
    },
    body: JSON.stringify({ op, ...params }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(String(data.error ?? `bridge HTTP ${res.status}`));
  }
  return data as T;
}

// ── Style profile ──────────────────────────────────────────────────────────────
// A structural sketch of the user's space (types in use, block styles, title
// shape — no note text) that the create tool embeds so the model writes notes
// that look native. Cached in-memory per (bridge, space): style drifts slowly,
// and one bridge round-trip per chat request would be pure overhead.

type StyleProfile = {
  types_in_use?: [string, number][];
  all_types?: string[];
  block_styles?: [string, number][];
  title_avg_words?: number | null;
  icon_emoji_ratio?: number | null;
  sampled_objects?: number;
};

const styleCache = new Map<string, { at: number; hint: string }>();
const STYLE_TTL = 10 * 60 * 1000;

// Compact, prompt-ready summary of the space's conventions (~2 short lines).
function profileToHint(p: StyleProfile): string {
  const parts: string[] = [];
  const types = (p.types_in_use ?? []).slice(0, 5).map(([name]) => name);
  if (types.length) parts.push(`The user's common object types: ${types.join(", ")}.`);
  const styles = (p.block_styles ?? []).slice(0, 5).map(([name]) => name);
  if (styles.length) parts.push(`Their notes are built from: ${styles.join(", ")} blocks.`);
  if (p.title_avg_words) {
    parts.push(`Titles are short (~${Math.round(p.title_avg_words)} words).`);
  }
  if (p.icon_emoji_ratio != null && p.sampled_objects) {
    parts.push(p.icon_emoji_ratio >= 0.5 ? "Most objects have an emoji icon; pick a fitting one." : "Objects usually have no icon; omit icon_emoji unless asked.");
  }
  return parts.join(" ");
}

export async function getStyleHint(
  bridge: BridgeConfig, spaceId: string, signal?: AbortSignal,
): Promise<string> {
  const key = `${bridge.url}|${spaceId}`;
  const hit = styleCache.get(key);
  if (hit && Date.now() - hit.at < STYLE_TTL) return hit.hint;
  try {
    const profile = await bridgeRpc<StyleProfile>(bridge, "style_profile", { space_id: spaceId }, signal);
    const hint = profileToHint(profile);
    styleCache.set(key, { at: Date.now(), hint });
    return hint;
  } catch {
    // Style is a nicety: never block writes on it.
    return hit?.hint ?? "";
  }
}
