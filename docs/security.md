# Authentication and agency security

Implemented in lib/auth.cjs, lib/config.cjs, server.cjs, public/auth.js, public/server-client.js and public/workspace.js. This document describes the implemented controls and tested boundaries, not an external penetration-test certification.

## Accounts and sessions

Operators provision agency owners/editors/viewers through the CLI. There is no anonymous signup, default production credential or password in browser storage. Passwords are 12–128 characters, individually salted and hashed with asynchronous scrypt (N=16384,r=8,p=1,64-byte result). Stored hashes and random salts are checked with a timing-safe comparison; unknown accounts use dummy hashing and generic errors.

Random 256-bit session cookie values are stored only as SHA-256 hashes. The CSRF/session binding is an HMAC using an independent private backend secret. Production cookies are __Host-scopewise, Secure, HttpOnly, SameSite=Strict, Path=/ with no Domain. Sessions expire after 8 hours absolute or 30 minutes idle; server activity updates idle time, and the UI checks the earliest expiry. There is no background loop that extends idle sessions indefinitely.

Login throttling persists in the selected database (SQLite locally, PostgreSQL when hosted): 10 attempts per username per 15-minute window, a larger peer limit and at most four concurrent password checks. The native server uses its socket peer; the Function uses Netlify context.ip. Caller-supplied forwarded IP headers have no authority. Provider abuse controls and measured capacity remain host-operation considerations.

Logout revokes its session; password reset, role changes and account revocation invalidate the user's sessions. The last active owner cannot be removed or demoted without another owner. Operator session revocation is available after a restore or security event.

## Agency and role boundaries

A session's current server user/agency selects storage. Caller-supplied agency IDs have no authority. Every protected read verifies the supplied bound token before selecting the tenant. A cookie from account B combined with an old tab's account-A token returns401 without B's data. Writes also enforce Origin, token, role, JSON/schema/references and expected revision.

Viewer writes and planner/import requests are denied on the server, before data mutation. Editors may edit/plan; explicit backup merging requires an owner. Agency IDs and globally unique record IDs are validated; cross-project and missing references are rejected. Local mode uses separate tenant databases. PostgreSQL queries bind to the server-selected agency and atomically save heads/history under an agency lock. Session/role checks inside the transaction reject writes after revocation during upload. This boundary is agency-wide; it does not implement per-project/field permissions or an immutable compliance audit log.

The browser binds requests and queued saves to the live user, agency and token. It rejects stale successful responses, old queued work, mismatched initialization status and delayed unauthorized responses from a replaced session. Modal and file-import callbacks capture identity before awaiting. Auth/session replacement masks/inerts the app and clears old volatile data before opening the new agency.

## Hosted transport and storage

The selected Netlify/Neon setup serves static pages and the Node API Function on one HTTPS origin. PostgreSQL holds all canonical data, accounts and sessions; there is no ephemeral SQLite fallback. TLS verifies database certificates, and URL options cannot disable it. Preview contexts/mismatched origins are rejected before connecting. Liveness does not query the database. Runtime secrets stay outside public files; API responses are private/no-store. Hosted bodies are limited to 4 MiB, stored states reserve 1 KiB for request envelopes and responses are capped at 5 MiB. See [free deployment](zero-cost-deployment.md).

The following proxy details apply only to the retained paid Render/Vercel alternative.

The Vercel frontend uses same-origin relative API paths. Its external route transform overwrites x-scopewise-proxy from a private Production environment value. Render checks it with a timing-safe comparison before any API route. This transport gate does not replace account authentication. The independent session secret stays on Render. Neither value is compiled into public files or checked into source.

Only the exact frontend HTTPS Origin can write. The backend HTTPS host is allowed for proxy/health routing, without granting it browser-Origin permission. Forwarded host/scheme/IP headers are not trusted for authorization. JSON and CDN responses use no-store; Vercel routing explicitly disables rewrite caching. Private source/data paths are not served; production frontend serving is off by default.

Requests receive UUID IDs and errors/logs omit password bodies, cookie values and secrets. Responses have content-type protection, framing restrictions, referrer controls and production HSTS. Static frontend CSP allows its own scripts; inline style support remains for existing programmatic UI styles. Whole JSON writes have an 8MB cap, depth/prototype-key protection and model validation.

Work paths reject escape/symlink traversal. Windows file ACLs are an operator responsibility. Render uses private managed secrets and a paid persistent work/ disk. Backup bundles contain password hashes and private workspace data: protect them and keep off-host copies. Public source archives exclude work/, DBs, passwords and secrets.

## Evidence and limits

npm test passes all ten suites, including twelve actual HTTP/SQLite security groups and eleven client/deployment checks. Security tests exercise two agencies, all roles, generic credential errors, proxy gates, Cookie/Set-Cookie forwarding through a local Node proxy, bound read tokens, CSRF, invalid JSON/prototypes, revision conflicts, logout/revocation, idle expiry, absolute expiry while active, restart persistence, damage preservation and log/config safeguards.

The local production fixture models HTTPS host/Origin headers over loopback HTTP. It does not test TLS or Vercel's real edge behavior. Hosted cookie acceptance, proxy header behavior, no caching, actual disk persistence, off-host recovery and load/capacity must pass on the chosen provider URLs before launch. Host account security, backups, spending limits and secret rotation belong to the operator deployment process.
