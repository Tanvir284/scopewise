# Scopewise agency workspace

Scopewise 3.0 adds authenticated multi-user agencies to the existing project, requirement, delivery, internal costing, team/time, CRM and commercial-draft workspace. Planning remains deterministic: 48 explainable rules, no AI provider or API key.

The selected deployment is a static Vercel frontend with relative /api requests proxied to a native Node backend on Render. Each agency has a separate SQLite workspace on a paid Render persistent disk. Docker and WSL are not required. Source, retained data, backups and test artifacts remain inside the repository directory.

## Run locally and provision access

Use Node 24 (tested locally with 24.11.0) and built-in node:sqlite. No dependency installation is needed.

    node scripts/admin.cjs agency-create --name "Your agency"
    node scripts/admin.cjs user-create --agency "ID_RETURNED_ABOVE" --username agency-owner --role owner
    npm.cmd start

The user command asks for a password privately in an interactive terminal; do not put it in arguments or chat. Open http://127.0.0.1:4173 and sign in. Account provisioning and role/password/revocation administration are operator CLI actions. There is no public signup or default production password.

Retained legacy work/data/scopewise.sqlite is never automatically assigned to a new agency. Use the explicit, confirmed adoption procedure in [backup and restore](docs/backup-restore.md) before that agency's first login if these records belong to it.

## Access and storage

| Account | Agency permissions |
| --- | --- |
| Owner | Read, edit, deterministic planning, and explicit backup merge. |
| Editor | Read, edit and deterministic planning. |
| Viewer | Read and export committed agency data; server rejects workspace/planner/import writes. |

Users belong to one agency; usernames are globally unique and case-insensitive. Role enforcement covers the whole agency workspace. There are no per-project or per-field permissions.

Authentication uses salted scrypt password hashes, hashed random session cookies, idle/absolute session expiry, login throttling and revocation. The browser holds its session/CSRF token only in memory. Protected reads also verify the bound token to reject cross-tab cookie/account mismatches before selecting a tenant. Writes require the exact frontend Origin, matching token, JSON, role, validation and expected workspace revision. See [security](docs/security.md).

Agency selection comes from the authenticated server record. Caller-supplied agency IDs do not select storage. Central accounts live in work/data/auth.sqlite; work/tenants/<agencyId>/scopewise.sqlite contains that agency's committed JSON/revisions. Saved data is shared among its authenticated users through the backend. Pending drafts use account/agency-scoped sessionStorage in the current tab and clear on session end. Export unsaved work before logout.

## Existing connected features

The black/charcoal/red interface retains its project shelves, featured project, detail views, forms and all 16 navigation areas. Projects, clients, source scope, rule evidence, changes, task criteria/status, sprints, milestones, issues, people, manual time, costing, opportunities, proposals, estimates, invoice drafts, reports and exports remain connected.

Internal cost uses explicit hours/rates and saved time-rate snapshots; client prices remain separate. Currencies stay separate without conversion. Missing rates remain unknown and zero remains an explicit zero. Editing current team rates does not reprice historical records. See [project costing](docs/project-costing.md) and [operations model](docs/operations-model.md).

Approvals, statuses and commercial drafts are human-entered records. The app sends no client notifications, charges no payment and does no automatic accounting.

## Verification and deployment

    npm.cmd test
    npm.cmd run test:operators

The main gate contains ten suites: eight existing feature/data/backend suites plus twelve security groups and eleven authenticated client/deployment checks. The separate operator gate covers ten actual SQLite backup/restore/provisioning/adoption scenarios. Browser checks and retained-data evidence are in [verification](docs/verification.md).

[Deployment](docs/deployment.md) contains the exact native Render Blueprint and Vercel setup. Configure the real backend URL using:

    node scripts/configure-vercel.cjs --backend https://ACTUAL.onrender.com
    node scripts/check-frontend.cjs

The checked-in .invalid URL is a reviewable template; hosted frontend builds fail until replaced. Private proxy secrets go into both providers' Production environment settings; the independent session secret stays on Render. Only public/ is Vercel's output directory. Source packaging excludes work/, databases, backups, credentials and historical Docker templates.

## Remaining launch gates

No public hosting purchase or deployment has occurred. Actual provider TLS, Vercel Cookie/Set-Cookie forwarding, disk persistence after redeploy and off-host recovery rehearsal remain unverified. These are required before real-user launch; successful local tests alone do not establish production readiness.

This backend is one native Node process/instance with SQLite. It requires a paid persistent disk, has redeploy downtime and retains full revision snapshots without automatic retention. Operator backup/monitoring and load validation remain necessary. Horizontal database scaling, client invitations, public signup, password-reset email and billing execution are not implemented.
