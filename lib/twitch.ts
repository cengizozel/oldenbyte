import { getTwitchApp } from "@/lib/appconfig";

// Twitch for the Twitch widget, through its official Helix API with the
// operator's own application (lib/appconfig getTwitchApp). An application
// token is requested with the client credentials and kept until shortly
// before it expires.

export type Channel = {
  login: string;
  name: string;
  avatar: string;
  live: boolean;
  title: string;
  game: string;
  viewers: number;
  startedAt: string;
};
export type Game = { id: string; name: string; art: string };

export class TwitchNotConnected extends Error {}

const LOGIN_RE = /^[a-zA-Z0-9_]{2,25}$/;
export const isLogin = (s: string) => LOGIN_RE.test(s);

let token: { value: string; clientId: string; expires: number } | null = null;

// Asks Twitch for an application token. Used on its own to check a pair of
// credentials before they are saved.
export async function requestToken(clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) throw new Error(res.status === 400 || res.status === 403 ? "Twitch refused the client ID or secret." : `Twitch answered HTTP ${res.status}.`);
  return { token: String(data.access_token), expiresIn: Number(data.expires_in) || 3600 };
}

async function helix(path: string): Promise<unknown> {
  const app = await getTwitchApp();
  if (!app) throw new TwitchNotConnected("Twitch is not connected");
  const call = async () => {
    if (!token || token.clientId !== app.clientId || Date.now() > token.expires) {
      const t = await requestToken(app.clientId, app.clientSecret);
      token = { value: t.token, clientId: app.clientId, expires: Date.now() + (t.expiresIn - 300) * 1000 };
    }
    return fetch(`https://api.twitch.tv/helix${path}`, {
      headers: { "Client-Id": app.clientId, Authorization: `Bearer ${token.value}` },
      signal: AbortSignal.timeout(10_000),
    });
  };
  let res = await call();
  if (res.status === 401) { token = null; res = await call(); }   // the token was revoked early: ask once more
  if (!res.ok) throw new Error(`Twitch answered HTTP ${res.status}.`);
  return res.json();
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Twitch's users and live streams to one row per channel, in the order asked:
// live channels carry their stream, the rest are offline. A login Twitch does
// not know is dropped. Exported for tests.
export function mapChannels(logins: string[], users: any, streams: any): Channel[] {
  const byLogin = new Map<string, any>(((users?.data ?? []) as any[]).map(u => [String(u.login).toLowerCase(), u]));
  const live = new Map<string, any>(((streams?.data ?? []) as any[]).map(s => [String(s.user_login).toLowerCase(), s]));
  return logins.map(l => l.toLowerCase()).filter(l => byLogin.has(l)).map(l => {
    const u = byLogin.get(l), s = live.get(l);
    return {
      login: l,
      name: String(u.display_name ?? l),
      avatar: String(u.profile_image_url ?? ""),
      live: !!s,
      title: String(s?.title ?? ""),
      game: String(s?.game_name ?? ""),
      viewers: Number(s?.viewer_count) || 0,
      startedAt: String(s?.started_at ?? ""),
    };
  });
}

// Twitch's box art addresses carry a {width}x{height} placeholder.
// Exported for tests.
export function mapGames(data: any): Game[] {
  return ((data?.data ?? []) as any[]).map(g => ({
    id: String(g.id ?? ""),
    name: String(g.name ?? ""),
    art: String(g.box_art_url ?? "").replace("{width}", "104").replace("{height}", "144"),
  })).filter(g => g.id && g.name);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// A short cache: who is live changes by the minute, the top games slowly.
const cache = new Map<string, { at: number; ttl: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), ttl, value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

export function channels(logins: string[]): Promise<Channel[]> {
  const list = [...new Set(logins.map(l => l.toLowerCase()).filter(isLogin))].slice(0, 50);
  if (!list.length) return Promise.resolve([]);
  return cached(`channels|${list.join(",")}`, 60_000, async () => {
    const q = (key: string) => list.map(l => `${key}=${encodeURIComponent(l)}`).join("&");
    const [users, streams] = await Promise.all([helix(`/users?${q("login")}`), helix(`/streams?first=100&${q("user_login")}`)]);
    return mapChannels(list, users, streams);
  });
}

export function topGames(): Promise<Game[]> {
  return cached("games", 5 * 60_000, async () => mapGames(await helix("/games/top?first=12")));
}
