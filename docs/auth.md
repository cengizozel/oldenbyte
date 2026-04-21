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

The Web Crypto API (`crypto.subtle`) is used directly — no third-party JWT or session library.

## Cookie Properties

```ts
res.cookies.set(SESSION_COOKIE, token, {
  httpOnly: true,   // not accessible via JS
  sameSite: "strict",
  path: "/",
  // no maxAge → session cookie, expires on browser close
});
```

## Middleware

`middleware.ts` runs on every request except `/login` and `/api/auth`. The matcher explicitly excludes Next.js static assets, images, and favicon:

```ts
matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"]
```

## Environment Variables

| Variable | Description |
|---|---|
| `DASHBOARD_PASSWORD` | The login password |
| `SESSION_SECRET` | Secret used to sign session tokens — generate with `openssl rand -hex 32` |

Neither variable has a safe default in production. If `SESSION_SECRET` is not set, the code falls back to `"fallback-secret"`, which is insecure and should never be used in a deployed environment.
