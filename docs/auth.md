# Authentication

## Overview

The dashboard has per-user accounts stored in the database. Passwords are hashed with scrypt, and a successful login creates a session row plus an HMAC-signed cookie that references it. Every request is verified in middleware before reaching any page or API route.

## Accounts

- **First run:** with no users in the database, the login page switches to "Create admin account" and posts to `POST /api/setup`. That endpoint only works while the user table is empty.
- **Roles:** `admin` or `user`. Admins manage accounts at `/admin` (`/api/admin/users`): create users, reset passwords, delete accounts.
- **Registration:** `POST /api/register` creates an account only when registration is open and a valid invite code is supplied; otherwise it returns 403.
- **Forced password change:** accounts created by an admin, or whose password an admin reset, carry `mustChangePassword`. The UI prompts for a new password on next login (`/api/account/password`).

## Flow

```
1. User submits username and password -> POST /api/auth
2. Server looks up the user and verifies the password hash (scrypt, constant-time compare)
3. On match: inserts a Session row, sets an httpOnly session cookie
4. Middleware verifies the cookie on every request
5. Invalid, missing or expired session -> redirect to /login (API routes: 401)
6. DELETE /api/auth logs out: deletes the session row and clears the cookie
```

Login is rate limited per client IP and per username.

## Session Token

The cookie value is `<sid>.<exp>.<sig>`:

- `sid` is a random 32-byte id. The database stores only its SHA-256 hash, so a leaked database does not yield usable cookies.
- `exp` is the expiry timestamp.
- `sig` is an `HMAC-SHA256` of `sid.exp` using `SESSION_SECRET`.

Verification recomputes the HMAC with constant-time comparison, then confirms the session row exists and has not expired. Sessions last 30 days from login and are not extended by activity. Expired rows are pruned periodically. The Web Crypto API (`crypto.subtle`) is used directly, with no third-party session library.

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

`proxy.ts` is the Next.js 16 middleware (the renamed `middleware` convention). It runs on every request except the public paths `/login`, `/api/auth`, `/api/setup` and `/api/register`. The matcher excludes Next.js static assets, images and the favicon:

```ts
matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"]
```

A request is allowed through if it carries a valid session cookie **or** a valid bearer token (see below). Otherwise API routes return `401 {"error":"Unauthorized"}` and page requests redirect to `/login`.

## Headless / Bearer token

For scripts and automation (e.g. configuring the dashboard via `/api/config`), set the `API_KEY` env var and send it as a bearer token:

```
Authorization: Bearer <API_KEY>
```

The middleware accepts this on any route. Requests authenticated this way act as the first admin account, so scripts operate on the admin's data. The token path is **disabled** unless `API_KEY` is set. The key is compared in constant time (`lib/auth.ts`, `apiKeyValid`).

## Environment Variables

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Signs session cookies. Generate with `openssl rand -hex 32`. **Required in production** |
| `API_KEY` | Optional bearer token for headless access. Unset = token auth disabled |

There is no password environment variable: the admin account is created in the browser on first run and all credentials live in the database.

`SESSION_SECRET` has no safe default in production: if it is unset the app **refuses to start** (`instrumentation.ts`), because the cookie would otherwise be signed with a constant that is public in this repo and therefore trivially forgeable. In development an unset secret falls back to a throwaway value so a local checkout runs without configuration.
