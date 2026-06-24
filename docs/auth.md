# Authentication

## Overview

The dashboard uses single-user password authentication. On successful login, the server issues an HMAC-signed session cookie. Every subsequent request is verified in middleware before reaching any page or API route.

## Flow

```
1. User submits password → POST /api/auth
2. Server compares against DASHBOARD_PASSWORD env var
3. On match: creates token, sets httpOnly session cookie
4. Middleware verifies cookie on every request
5. Invalid/missing cookie → redirect to /login
```

## Token Format

Tokens are `HMAC-SHA256` signatures using the `SESSION_SECRET` environment variable:

```
authenticated.<hex-encoded-hmac-signature>
```

The payload is always the static string `"authenticated"`. The HMAC signs it with the secret, producing a token that cannot be forged without the secret. Verification recomputes the HMAC and compares with constant-time string equality.

```ts
// lib/auth.ts
const payload = "authenticated";
const sig = await hmac(secret, payload);
return `${payload}.${sig}`;
```

The Web Crypto API (`crypto.subtle`) is used directly - no third-party JWT or session library.

## Cookie Properties

```ts
res.cookies.set(SESSION_COOKIE, token, {
  httpOnly: true,   // not accessible via JS
  sameSite: "strict",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,  // persists for 30 days
});
```

## Middleware

`proxy.ts` is the Next.js 16 middleware (the renamed `middleware` convention). It runs on every request except `/login` and `/api/auth`. The matcher explicitly excludes Next.js static assets, images, and favicon:

```ts
matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"]
```

A request is allowed through if it carries a valid session cookie **or** a valid bearer token (see below). Otherwise API routes return `401 {"error":"Unauthorized"}` and page requests redirect to `/login`.

## Headless / Bearer token

For scripts and automation (e.g. configuring the dashboard via `/api/config`), set the `API_KEY` env var and send it as a bearer token:

```
Authorization: Bearer <API_KEY>
```

The middleware accepts this on any route, granting the same access as a logged-in session. The token path is **disabled** unless `API_KEY` is set. The key is compared in constant time (`lib/auth.ts` → `apiKeyValid`).

## Environment Variables

| Variable | Description |
|---|---|
| `DASHBOARD_PASSWORD` | The login password |
| `SESSION_SECRET` | Secret used to sign session tokens - generate with `openssl rand -hex 32`. **Required in production** |
| `API_KEY` | Optional bearer token for headless access. Unset = token auth disabled |

`SESSION_SECRET` has no safe default in production: if it is unset the app **refuses to start** (`instrumentation.ts`), because the cookie would otherwise be signed with a constant that is public in this repo and therefore trivially forgeable. In development an unset secret falls back to a throwaway value so a local checkout runs without configuration.
