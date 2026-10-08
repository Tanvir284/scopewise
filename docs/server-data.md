# Authenticated server, tenant data and recovery

Scopewise uses Node 24 built-ins and SQLite. Development binds to loopback and serves approved static assets; production binds to the configured interface and normally serves only API/health routes behind the selected Vercel frontend proxy. PORT supports Render's runtime binding.

## Agency storage and consistency

work/data/auth.sqlite holds agencies, salted password hashes, users/roles, hashed sessions and login limits. Each authenticated user belongs to one agency. Its UUID selects work/tenants/<agencyId>/scopewise.sqlite and that tenant's backup directory. Requests cannot select another agency by body, query or headers.

A tenant database stores the full workspace JSON, current revision/timestamp, saved revision snapshots and completed import ledger. WAL with FULL synchronous transactions protects commits. Whole-workspace optimistic revision checks reject concurrent stale writes with 409. This is shared agency storage with a coarse role boundary; it is not a normalized relational permissions model.

New agencies start empty, with valid operations arrays and an initial revision. Samples and the retained legacy database are never automatically injected into every account. Explicit operator adoption before first login preserves the old JSON, revision and timestamp. See [operator recovery](backup-restore.md).

Reads validate the saved workspace. Damaged data returns STORAGE_DAMAGED without replacing it. A different valid agency remains usable. /health/ready checks authentication availability, an active owner and currently opened tenant stores; it is not a scan of every stored tenant or a recovery/authorization acceptance test. /health/live is minimal and supports initial host bootstrapping before owner provisioning.

Revision history retains complete snapshots, with the latest 200 metadata rows exposed to that agency. There is no automated history retention, historical restore UI or arbitrary destructive reset.

## HTTP interface

| Endpoint | Access and behavior |
| --- | --- |
| GET /api/auth/session | Proxy/origin gated session probe; anonymous returns authenticated:false. |
| POST /api/auth/login | Same-origin JSON credentials, throttled authentication, new cookie and in-memory token. |
| POST /api/auth/logout | Session, Origin and token required; revokes cookie session. |
| GET /api/status | Authenticated bound token; own user/agency, role, planner, revision and migration policy. |
| GET /api/session | Authenticated bound token; current token. |
| GET /api/workspace | Authenticated bound token; own canonical state, revision and timestamp. |
| PUT /api/workspace | Owner/editor, Origin/token and valid expected revision; atomic commit. |
| POST /api/migrate | Owner only; explicit conflict-aware merge with tenant-local snapshots. |
| POST /api/plan | Owner/editor; saved own project/baseline and limits; deterministic output, no automatic commit. |
| GET /api/history | Authenticated bound token; own revision metadata. |
| GET /api/backup | Authenticated bound token; own committed JSON export. |
| GET /health/live | Anonymous minimal liveness; no account/workspace details. |
| GET /health/ready | Anonymous minimal readiness; 503 before owner provisioning or loaded-store failure. |

Protected GETs require X-Scopewise-Token as well as the session cookie. If another browser tab replaces the cookie, a stale tab's token is rejected before loading the new cookie's tenant. The session probe is the explicit identity-refresh route. Writes additionally require the exact configured browser Origin, JSON and matching role. No browser CORS access is enabled.

## Explicit import and pending drafts

Automatic browser migration is disabled for authenticated workspaces. Legacy localStorage remains preserved and unassigned. Owners may deliberately import a valid backup intended for their agency. Before merging, incoming and current JSON snapshots are retained in that tenant's backups. Disjoint IDs merge; divergent existing records/settings produce 409 with both copies preserved. Completed imports do not resurrect later-removed records on replay, including after normalization adds empty collections.

Pending drafts and recovery histories use account/agency-scoped sessionStorage in the current tab. Server saves validate again and compare the base revision. Own queued saves update only their own generations. Conflicts block overwrite until the latest state is reviewed; damaged journals are retained as raw recovery data. Old requests, imports, modal callbacks and successful responses are guarded against identity/token changes.

Logout, expiry or session replacement clears old in-memory state and scoped pending journals; saved server records remain. Export pending work first. A displayed workspace export can include unsaved edits; /api/backup is committed data. This is not a complete offline installation.

## Operations

Use one process and one Render instance. SQLite data, backups and secrets belong on the private work/ disk mount, never in Vercel output or Git. Do not copy an active SQLite main file without WAL handling. Operator tools use SQLite snapshots and checksummed bundles; coordinated cross-database backups/restores require actual write quiescence, not merely a flag.

[Deployment](deployment.md), [security](security.md), [backup/restore](backup-restore.md) and [verification](verification.md) describe exact configuration, evidence and remaining host checks.
