# Authentication

## Overview

The dashboard has per-user accounts stored in the database. Passwords are hashed with scrypt, and a successful login creates a session row plus an HMAC-signed cookie that references it. Every request is checked in middleware before reaching any page or API route, and every API handler then confirms the session against the database.

## Accounts

- **First run:** with no users in the database (`GET /api/auth/state` reports `needsSetup`), the login page switches to "Create admin account" and posts to `POST /api/setup`. That endpoint only works while the user table is empty. The new admin also claims any settings and uploads left from the single-user era.
- **Roles:** `admin` or `user`. Admins manage accounts at `/admin` (`/api/admin/users`): list accounts, reset passwords, delete accounts. The same page sets the registration toggle, the invite code and the feed cache TTL (`/api/admin/config`). Admin accounts may also point integrations (Kiwix, CalDAV, Anytype, TubeArchivist, TV, LLM servers) at LAN or tailnet addresses; other accounts are limited to public addresses (see [architecture.md](architecture.md#outbound-fetches-and-ssrf)).
- **Registration:** there is no admin "create user" action; new accounts come from `POST /api/register`, which creates a regular account only when registration is enabled and a valid invite code is supplied (otherwise 403). With no invite code set, registration is closed.
- **Forced password change:** an admin password reset sets a temporary password and `mustChangePassword`. Until the user picks a new one (`/api/account/password`, also in the settings panel's Account section), every API route except `/api/me` and `/api/account/password` answers `403 password_change_required`.

## Flow

1. The user submits username and password to `POST /api/auth`.
2. The server looks up the user and verifies the password hash (scrypt N=2^16, r=8, p=1, constant-time compare). A hash made with older, weaker parameters is upgraded in place on that login.
3. On match it inserts a Session row and sets an httpOnly session cookie, named `__Host-session` in production (Secure, Path=/, no Domain, so no other subdomain can set it) and `session` in development.
4. The middleware checks the cookie signature on every request; route handlers look the session up in the database.
5. An invalid, missing or expired session redirects to `/login` (API routes: 401).
6. `DELETE /api/auth` logs out: it deletes the session row and clears the cookie. Changing your password, an admin reset, or deleting the account ends all of that account's sessions.

Login takes usernames up to 64 and passwords up to 200 characters, and is rate limited per client IP plus username, per client IP, per username, and globally (60 attempts a minute across everyone). An address that has already logged in as a user skips the per-username and global limits for that user, so someone hammering them cannot lock the owner out. At most two scrypt hashes run at once (`lib/password.ts`). Registration, setup and password changes are rate limited too (`lib/ratelimit.ts`, all in memory, reset on restart).

## Session Token

The cookie value is `<sid>.<exp>.<sig>`:

- `sid` is a random 32-byte id. The database stores only its SHA-256 hash, so a leaked database does not yield usable cookies.
- `exp` is the expiry timestamp.
- `sig` is an `HMAC-SHA256` of `sid.exp` using `SESSION_SECRET`.

Verification recomputes the HMAC with constant-time comparison, then confirms the session row exists and has not expired. Sessions last 30 days from login and are not extended by activity. Expired rows are pruned at startup and every 6 hours (`lib/maintenance.ts`). The Web Crypto API (`crypto.subtle`) is used directly, with no third-party session library.

## Cookie Properties

```ts
// lib/session.ts
{
  httpOnly: true,                                  // not accessible via JS
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",  // HTTPS only in production
  path: "/",
  maxAge: 60 * 60 * 24 * 30,                       // 30 days
}
```

Because the cookie is `secure` in production, a login over plain `http://` (for example a LAN IP) does not persist; use the HTTPS domain.

## Middleware

`proxy.ts` is the Next.js 16 middleware (the renamed `middleware` convention). It lets the public paths `/login`, `/api/auth` (including `/api/auth/state`), `/api/setup` and `/api/register` through. The matcher always runs it for API routes, and for pages it excludes Next.js static assets, images, the favicon and `.png` files (so the login screen's images load):

```ts
matcher: [
  "/api/:path*",
  "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)",
]
```

The middleware only checks the cookie signature (it runs on the edge runtime). The authoritative check, including revoked sessions and roles, happens in each route handler through `requireUser` / `requireAdmin` (`lib/http.ts`, `lib/session.ts`).

A request is allowed through if it carries a valid session cookie **or** a valid bearer token on `/api/config` (see below). Otherwise API routes return `401 {"error":"Unauthorized"}` and page requests redirect to `/login`.

State-changing API requests (anything but GET, HEAD, OPTIONS) from a browser must come from this exact host: if `Sec-Fetch-Site` is present it must be `same-origin` or `none`, and if `Origin` is present its host must match the request host. Otherwise the middleware returns `403`. This blocks cross-site and same-site (other subdomain) request forgery on top of the `SameSite=Lax` cookie. Bearer requests skip this check.

## Headless / Bearer token

For scripts and automation (e.g. configuring the dashboard via `/api/config`), set the `API_KEY` env var and send it as a bearer token:

```
Authorization: Bearer <API_KEY>
```

The token is accepted on `/api/config` only; every other route needs a session. Requests authenticated this way act as the first admin account, so scripts operate on the admin's data. The token path is **disabled** unless `API_KEY` is set to at least 32 characters (a shorter key is ignored, with a warning at startup). The key is compared in constant time (`lib/auth.ts`, `apiKeyValid`, `bearerAllowed`).

## Environment Variables

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Signs session cookies. Generate with `openssl rand -hex 32`. **Required in production** |
| `API_KEY` | Optional bearer token for headless access to `/api/config`, at least 32 characters. Unset or shorter = token auth disabled |

There is no password environment variable: the admin account is created in the browser on first run and all credentials live in the database.

`SESSION_SECRET` has no safe default in production: if it is unset the app **refuses to start** (`instrumentation.ts`), because the cookie would otherwise be signed with a constant that is public in this repo and therefore trivially forgeable. In development an unset secret falls back to a throwaway value so a local checkout runs without configuration.
