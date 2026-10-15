# Scopewise: $0 deployment with Netlify and Neon

Initial guide: 9 October 2026. Free-plan quotas and environment guidance rechecked on 15 October 2026. Source is prepared; no provider account or public deployment was created or tested.

Use standard Netlify Free for static pages and a Node 24 API Function, and an owned Neon Free PostgreSQL database. Accounts, password hashes, sessions, login throttles, agency records, revision history and import snapshots persist in PostgreSQL. Function restarts do not erase canonical data.

The current free plans support this commercial use. Their quotas can pause service, and they do not guarantee continuous uptime or permanent free availability. Keep both accounts on Free, use the included netlify.app address and avoid paid add-ons. [Netlify commercial use](https://www.netlify.com/guides/netlify-vs-vercel/#can-i-use-netlifys-free-plan-for-commercial-projects), [Neon terms](https://neon.com/platform-terms), [governing business agreement](https://www.databricks.com/legal/mcsa)

## Why the previous choice changed

| Provider | Reason |
| --- | --- |
| Vercel Hobby | Personal, noncommercial use only. [Official terms](https://vercel.com/docs/plans/hobby) |
| Render Free | Official docs discourage production use. Filesystem is ephemeral; free PostgreSQL expires after 30 days, then a 14-day grace period. [Render Free](https://render.com/docs/free) |
| Supabase Free | Low-activity projects can pause after seven days. Free projects need independent dumps; downloadable provider backups are unavailable. [Pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [backups](https://supabase.com/docs/guides/platform/backups) |

## 1. Prepare source locally

Open PowerShell in the Scopewise repository. Existing users must preserve work/ and their backups. A fresh installation can use:

~~~powershell
git clone https://github.com/Tanvir284/scopewise.git
cd scopewise
npm.cmd ci
npm.cmd test
npm.cmd run test:operators
npm.cmd run check:netlify
~~~

Use Node 24.11 or later within 24.x. npm works instead of npm.cmd on other shells. If Codex’s Windows sandbox denies the hard link used by the separate SQLite operator check, run that command in your normal trusted PowerShell terminal; do not disable its recovery safeguards. pg is the PostgreSQL dependency; PGlite is for tests only. Local SQLite remains available. No Docker, WSL or AI service is needed.

## 2. Create Neon Free PostgreSQL

1. Sign in to [Neon](https://console.neon.tech/) and select standard Free.
2. Create one Scopewise project. Use its owned default production root branch/database. Avoid unclaimed temporary databases or expiring preview branches.
3. Choose an available US AWS region near Netlify's default Ohio Function region. Leave compute at the smallest available size, normally 0.25 CU, with idle suspension enabled.
4. Open Connect, select the database/owner role and enable connection pooling. Privately copy the PostgreSQL URL with its -pooler hostname and sslmode=require, optionally channel_binding=require.
5. Create work/neon.env in a private editor:

~~~dotenv
SCOPEWISE_STORAGE=postgres
DATABASE_URL="PASTE_THE_REAL_NEON_POOLED_POSTGRESQL_URL"
~~~

Replace the placeholder with the actual encoded URL. The adapter verifies TLS certificates and rejects URL options that could disable verification. Keep the file private and ignored by Git; never put credentials in arguments, frontend files, screenshots or messages. Node loads it only through --env-file. This setup uses Scopewise accounts, not Neon Auth.

Initialize explicitly:

~~~powershell
node --env-file=work/neon.env scripts/postgres-admin.cjs init
~~~

There is no automatic schema creation, demo seed or SQLite fallback at hosted startup.

## 3. Migrate existing SQLite records, or start empty

### Existing SQLite installation

Stop every local Scopewise server and other writer first. Keep the original work directory. Export and restore into the still-empty Neon schema:

~~~powershell
node scripts/postgres-admin.cjs sqlite-export --work work --output work/backups/sqlite-cutover.json --quiescent
node --env-file=work/neon.env scripts/postgres-admin.cjs import --input work/backups/sqlite-cutover.json --confirm-empty-target
~~~

Use a new filename if it already exists. --quiescent records your confirmation that writers are stopped; the tool does not stop them. Without it, the portable bundle retains an individual-database-snapshots consistency warning.

The tool first makes separate SQLite snapshots, then preserves accounts/password hashes, agency IDs, exact raw workspace JSON, revisions/timestamps, all operations/cost records, import snapshots and retained artifacts. Older SQLite ledgers have no server revision, so their transferred server_revision is 0 (unknown). Sessions and secrets are excluded. Missing/damaged ledger files fail export and preserve the source and completed SQLite snapshots.

Import validates checksums, relationships and head/history agreement before writing, refuses occupied targets and restores transactionally. Do not create accounts first if restoring. Existing accounts retain passwords and sign in again.

### Empty installation, or legacy data without accounts

Create an agency and first owner:

~~~powershell
node --env-file=work/neon.env scripts/postgres-admin.cjs agency-create --name "Your agency"
node --env-file=work/neon.env scripts/postgres-admin.cjs user-create --agency AGENCY_ID --username agency-owner --role owner
~~~

Use the returned actual agency ID. The terminal asks for a hidden 12–128 character password and confirmation. Usernames are unique across the installation. There is no default account or public signup.

A migrated old workspace without accounts stays unassigned. Before the new agency's first workspace access, list and explicitly adopt it:

~~~powershell
node --env-file=work/neon.env scripts/postgres-admin.cjs legacy-list
node --env-file=work/neon.env scripts/postgres-admin.cjs adopt-legacy --legacy LEGACY_ID --agency AGENCY_ID --confirm-agency AGENCY_ID
~~~

Repeat the intended actual agency ID exactly. Adoption refuses an agency that already has a workspace. It keeps the original legacy payload. For restored agency accounts, inspect agency-list/user-list instead of recreating them.

## 4. Generate the session secret

~~~powershell
node scripts/admin.cjs secret-create --file work/secrets/netlify-session-secret
~~~

Privately open that file and copy its single value to Netlify below. Keep a private independent copy. Do not print it or commit it. If the file exists, retain that secret or choose a new private path.

## 5. Configure Netlify Free

1. Sign in to [Netlify](https://app.netlify.com/); use a standard Free team/project.
2. Choose Add new project / Import an existing project, connect GitHub and select Tanvir284/scopewise or your fork.
3. Select main and the full repository root. netlify.toml supplies build command node scripts/check-netlify.cjs, publish directory public, Functions directory netlify/functions, build Node 24.11.0 and esbuild bundling.
4. Choose a stable project name and note its exact HTTPS netlify.app origin. An initial deploy without runtime settings safely returns API 503. Successful production deploys consume credits, so avoid unnecessary redeploys.
5. In Project configuration → Environment variables, add:

| Variable | Runtime value |
| --- | --- |
| SCOPEWISE_STORAGE | postgres |
| DATABASE_URL | Private pooled Neon URL |
| SCOPEWISE_SESSION_SECRET | Private value generated above |
| SCOPEWISE_PUBLIC_ORIGIN | Exact production origin, e.g. https://your-project.netlify.app, no path/query |
| AWS_LAMBDA_JS_RUNTIME | nodejs24.x |

On standard Free, leave scopes at All; a Functions-only scope selector requires a paid plan. Set contextual values for Production only, with no all-context fallback or preview values. Production build code can therefore access these credentials: trust the production branch and its build scripts. Do not expose them to untrusted preview builds. Runtime variables belong in the UI/CLI/API, not public code or netlify.toml. AWS_LAMBDA_JS_RUNTIME requires a redeploy. [Runtime environment variables](https://docs.netlify.com/build/functions/environment-variables/), [Node runtime configuration](https://docs.netlify.com/build/functions/configuration/)

Leave SCOPEWISE_PROXY_SECRET, SCOPEWISE_BACKEND_ORIGIN, RENDER_EXTERNAL_URL and SCOPEWISE_SESSION_SECRET_FILE unset on this deployment.

6. Trigger a production deploy after settings are saved. Confirm the build includes the api Function and only public/ is published.
7. New Free teams can have private project URLs by default. When configured, use Project configuration → General → Visitor access → Project visibility → Public. This exposes the Scopewise sign-in page; accounts still protect agency APIs. [Visibility settings](https://www.netlify.com/changelog/2026-07-28-start-with-private-project-urls/)
8. Share the stable URL and user credentials privately. App users do not need provider team seats.

Preview contexts and mismatched origins are rejected before database connection. Use the production URL. Changing it requires updating SCOPEWISE_PUBLIC_ORIGIN and redeploying.

## 6. Verify the real hosted app before inviting users

1. Open the stable URL privately and confirm HTTPS/sign-in.
2. /health/live should return status ok without querying PostgreSQL. /health/ready requires reachable PostgreSQL and an active owner in an active agency.
3. Sign in as owner; save a synthetic client/project, reload it and create a requirement draft with linked tasks.
4. Sign out; test editor and viewer. Viewer can read/export the entire agency, including internal costs, but cannot save, plan or merge.
5. Create a second agency/owner and confirm it starts empty and sees none of the first agency's data.
6. Redeploy and wait through idle suspension. Confirm saved records/rates/costs persist. Session expiry can legitimately require login.
7. Export the database and rehearse restore to a separate empty database.
8. Check both provider usage dashboards and stop test activity near quota.

The local PostgreSQL tests use actual PostgreSQL SQL through PGlite and test transaction rollback, API roles and recovery. Their serial connection shim cannot establish real multi-client locking, hosted TLS, Netlify routing/cookies or capacity. Those require this acceptance run. No hosted deployment has been performed.

## 7. Manage users from your trusted computer

~~~powershell
node --env-file=work/neon.env scripts/postgres-admin.cjs agency-list
node --env-file=work/neon.env scripts/postgres-admin.cjs user-list --agency AGENCY_ID
node --env-file=work/neon.env scripts/postgres-admin.cjs user-create --agency AGENCY_ID --username agency-editor --role editor
node --env-file=work/neon.env scripts/postgres-admin.cjs user-create --agency AGENCY_ID --username agency-viewer --role viewer
node --env-file=work/neon.env scripts/postgres-admin.cjs user-reset --user USER_ID
node --env-file=work/neon.env scripts/postgres-admin.cjs user-role --user USER_ID --role viewer
node --env-file=work/neon.env scripts/postgres-admin.cjs user-revoke --user USER_ID
~~~

Use actual IDs. Reset/role/revoke operations invalidate sessions. The last active owner is protected. Hosted saves recheck current access inside the transaction, including after a slow upload.

All roles see their whole agency. There are no per-project/field permissions or invitation/password-reset emails. Planning team records are separate from sign-in accounts. Scopewise owners do not receive provider/database credentials.

## 8. Back up and recover

Export regularly and before source/schema changes, using a new dated filename:

~~~powershell
node --env-file=work/neon.env scripts/postgres-admin.cjs export --output work/backups/postgres-2026-10-15.json
~~~

The portable export captures one consistent PostgreSQL recovery point: accounts, all agencies, exact workspaces/history/import snapshots and retained legacy/artifact data. Sessions, throttles and secrets are excluded. SHA-256 detects accidental corruption; the bundle is neither signed nor encrypted. Keep encrypted, access-controlled off-computer copies using storage you already have. Browser exports contain only current agency records and are not complete operator backups.

For recovery, stop writes, create another empty owned database and put its URL in a separate private work/recovery.env:

~~~powershell
node --env-file=work/recovery.env scripts/postgres-admin.cjs init
node --env-file=work/recovery.env scripts/postgres-admin.cjs import --input work/backups/postgres-2026-10-15.json --confirm-empty-target
~~~

Verify accounts, revisions, records and cost summaries. Then update Netlify DATABASE_URL, set a fresh managed session secret and redeploy. Users sign in again. Retain the original until recovery is verified.

Operator restore preserves existing raw data. Historical gzip snapshots have a 64 MiB decompression cap and fail explicitly beyond it. A restored current workspace over the hosted API limits needs review before launch; retain its backup and use operator export.

## Quotas, sleep, expiry and cost limits

| Service | Current limit or behavior |
| --- | --- |
| Netlify standard Free | 300 credits/month shared by the team; no rollover or extra-credit purchases. Exhaustion pauses all team projects until reset/upgrade. [Billing FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/) |
| Netlify rates | 15 credits/production deploy; 10/GB-hour compute; 20/GB bandwidth; 2/10,000 web requests, including static assets. These consume the same allowance. [Credit calculation](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) |
| Neon Free | 1 GB/project, 20 GB/account total; 100 CU-hours/project/month; 5 GB public egress/project/month; 10 branches/project. Sleeps after five idle minutes; no Free uptime SLA. [Current official plan source](https://raw.githubusercontent.com/neondatabase/website/main/content/docs/introduction/plans.md) |
| Neon at quota | Compute/egress exhaustion suspends compute until reset/upgrade. Storage limits can block writes, including updates/deletes. Quota exhaustion does not itself delete data. [Plan limits](https://raw.githubusercontent.com/neondatabase/website/main/content/docs/introduction/plans.md) |
| Neon recovery | Up to six hours or 1 GB of change history, whichever is smaller. Independent exports remain necessary. Paid snapshot schedules are outside this setup. [Current recovery limits](https://raw.githubusercontent.com/neondatabase/website/main/content/docs/introduction/plans.md) |
| Scopewise hosted limits | 4 MiB request body; stored state reserves 1 KiB for its save envelope; 5 MiB response. Whole-workspace saves and history consume database storage/bandwidth. |
| Netlify Function defaults | Node 24, Ohio region, 1 GB memory, 60-second synchronous limit and 6 MB buffered provider payload limit. App limits are smaller. [Function configuration](https://docs.netlify.com/build/functions/configuration/) |

Four production deploys consume 60 credits, leaving 240 for other metered activity. At 0.25 CU, 100 CU-hours permits 400 active hours, less than an always-on month. Constant readiness probes/queries prevent idle savings. No fixed number of users is promised.

An owned production Neon project has no documented routine inactivity-deletion deadline in the sources checked. Temporary resources differ: unclaimed databases expire after 72 hours, and new Console child branches can default to one-day deletion. Use the owned root branch and inspect expiration settings. [Claimable databases](https://github.com/neondatabase/website/blob/main/content/docs/guides/platform-integration-overview.md), [branch expiry](https://github.com/neondatabase/website/blob/main/content/docs/guides/branch-expiration.md)

Stay on Free and do not enable paid add-ons, extra resources, custom-domain purchases or paid snapshot schedules. Recheck current terms before launch; Netlify can discontinue its Free tier at its discretion. [Netlify terms](https://www.netlify.com/legal/self-serve-subscription-agreement/)

## Troubleshooting

| Result | Action |
| --- | --- |
| 503 STORAGE_REQUIRED | Set runtime SCOPEWISE_STORAGE=postgres and redeploy. |
| 503 SERVICE_UNAVAILABLE | Check private variables, URL, schema init, Neon quota and availability. Never paste credentials into support messages. |
| 403 INVALID_HOST | Use the exact production origin; preview APIs are rejected. |
| 403 PROXY_REQUIRED | Remove old proxy/backend settings from this same-origin setup. |
| 401 after expiry or account changes | Sign in again; old tokens cannot read another account's agency. |
| 409 REVISION_CONFLICT | Load newest records and review before retrying. |
| 409 MIGRATION_CONFLICT | Both snapshots are preserved; export/review conflicting records or relationships. |
| 413 | Preserve the backup; use operator export and reduce/split records before browser use. |
| URL asks for Netlify login | Set project visibility Public after runtime setup. |
| Quota pause | Inspect usage/reset date; wait for reset or migrate a verified backup. Keep Free if the budget is $0. |

The older paid SQLite/Render/Vercel path remains documented separately in deployment.md.
