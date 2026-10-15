# Deployment choices

The selected $0 setup is **Netlify Free + Neon Free PostgreSQL**. Follow [zero-cost-deployment.md](zero-cost-deployment.md) for the current operator steps and limits. No public hosted application has been deployed or verified.

The remainder preserves the older paid SQLite option. It requires a paid persistent disk and a commercial-eligible Vercel plan; do not use it as a Free deployment guide.

# Older paid Vercel frontend and native Render backend

This alternative deployment serves the frontend on Vercel and runs `node server.cjs` as a native Render Node service. Docker and WSL are excluded from this workflow. Their earlier templates are retained as historical alternatives and are not required or verified deployment steps. No hosting purchase, public deployment, domain purchase, or hosted TLS/session test has been performed.

The browser uses relative `/api/` URLs on its Vercel origin. Vercel proxies those requests to Render; SQLite and authentication records remain on Render's persistent disk. This design keeps the existing strict session cookies and origin checks. The backend does not enable browser CORS access.

## Files and host requirements

`deployment/render.yaml` defines only the backend. Select that path when creating a Blueprint, keep the repository root unchanged, and review the service name and Singapore region before creation. It pins native Node `24.21.0`, runs the test suite with deployment-only origin/secret/storage variables cleared for test fixtures, starts `node server.cjs`, and probes `/health/live`. Render supports exact Node version selection through `NODE_VERSION`. [Render Node versions](https://render.com/docs/node-version).

The template selects one paid `0.5c-512mb` instance, a 1 GB disk, manual deploys, and no production preview configuration. The disk mounts at `/opt/render/project/src/work`, underneath Render's documented native source root. Only that mount persists. Disks are unavailable during build/predeploy commands and one-off jobs; a disk-backed service cannot run multiple instances and has brief redeploy downtime. These constraints fit the current local SQLite design, but they do not establish capacity for a particular workload. [Render persistent disks](https://render.com/docs/disks).

Use the exact stable Vercel production origin for `SCOPEWISE_PUBLIC_ORIGIN`, such as `https://scopewise.example.com` or the project's production `vercel.app` address. Random preview domains are not production login origins. `SCOPEWISE_BACKEND_ORIGIN` admits the backend Host only; it never grants permission for a browser write Origin. Render supplies its HTTPS service URL through `RENDER_EXTERNAL_URL` and its listening port through `PORT` (normally 10000). The server binds to `0.0.0.0`. [Render environment variables](https://render.com/docs/environment-variables), [port binding and TLS](https://render.com/docs/web-services).

`deployment/native.env.example` contains metadata examples, not secret values. Configure host settings in the provider dashboards; Node does not automatically load this example as a dotenv file. Production serves API/health endpoints on Render, with frontend assets deployed through Vercel.

## Proxy, secrets, and caching

The Blueprint generates independent `SCOPEWISE_SESSION_SECRET` and `SCOPEWISE_PROXY_SECRET` values. Render documents `generateValue: true` as a randomized base64-encoded 256-bit value, retained when already present. Keep the session secret on Render. Privately copy the proxy secret into the Vercel project's **Production** environment setting of the same name. Never place either value in repository files, browser assets, terminal commands, or logs. [Render Blueprint secret generation](https://render.com/docs/blueprint-spec).

The Vercel API route transform replaces `x-scopewise-proxy` with that managed proxy secret. The backend rejects API requests without the matching header. Normal session, role, and agency checks still apply; workspace writes also require the exact frontend Origin and a valid CSRF token. Forwarded Host/scheme/IP headers do not establish identity or write authorization. The proxy secret is a transport gate rather than an account credential. Vercel documents this managed-header pattern for restricting an external origin. [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

Current Vercel projects can cache external responses according to upstream headers by default. The generated routing configuration must explicitly set `x-vercel-enable-rewrite-caching: 0` and keep API browser/CDN cache policies at `no-store`. Do not add public cache lifetimes to login, session, workspace, or error responses. Static frontend assets may use the platform's asset cache. [Vercel rewrite caching](https://vercel.com/docs/routing/rewrites).

Production cookies use `__Host-scopewise`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and no Domain attribute. The selected design relies on the hosted proxy preserving login `Set-Cookie` and subsequent request `Cookie` headers. Verify that behavior on the actual frontend domain before real users; local proxy checks are not a Vercel acceptance result. Do not change to third-party cookies or broaden allowed origins to work around a routing error.

Managed secrets avoid relying on undocumented secret-file Unix modes. A manually selected `SCOPEWISE_SESSION_SECRET_FILE` remains available instead of the managed session value: use a private file with mode 600 and private directories. Do not configure both session-secret sources. Rotating a session secret alone does not delete database sessions; use the administration revocation command when logout of all users is required. Rotate the proxy secret in both hosts during a controlled change and verify matching versions before restoring traffic.

## Operator setup after separate publication approval

1. Review account ownership, region, disk size, spending limits, and the stable frontend origin. Protect both provider operator accounts with strong account security. Keep production work data, backups, password-input files, and secrets out of Git and the frontend publish directory.
2. Create the paid native Render service from `deployment/render.yaml`. Supply the exact frontend `SCOPEWISE_PUBLIC_ORIGIN` when prompted. Leave `SCOPEWISE_BACKEND_ORIGIN` unset when using the supplied `RENDER_EXTERNAL_URL`. Record the actual backend HTTPS URL. Do not attach a backend custom domain without updating allowed Host configuration and checking health probes.
3. Use the regular running-instance Render SSH connection for privileged account provisioning. Paid web services support SSH and Dashboard shell; build/predeploy and isolated ephemeral jobs do not operate on this persistent workspace. Run from `/opt/render/project/src`. [Render SSH and shell](https://render.com/docs/ssh).
4. Create each agency and its owner before distributing access. If assigning retained legacy records, adopt them into the intended new agency before its first login. Add editors and viewers separately.
5. Configure the frontend's generated `vercel.json` with the actual Render URL. Keep the Vercel project rooted at the full repository, build with `node scripts/check-frontend.cjs`, and publish only `public`. Set the matching private `SCOPEWISE_PROXY_SECRET` in Vercel Production. The placeholder backend ending in `.invalid` deliberately fails the frontend check until configured.
6. Deploy only after operator authorization, then complete the hosted acceptance checks below. Do not give production secrets to arbitrary preview deployments; use a separate backend, disk, accounts, and origins for a staging environment.

Configure the frontend destination from the project root, substituting the actual Render service URL. The command writes only the public destination URL; secrets remain in host settings:

```text
node scripts/configure-vercel.cjs --backend https://ACTUAL.onrender.com
node scripts/check-frontend.cjs
```

Agency provisioning commands use public account identifiers, never password arguments:

```text
node scripts/admin.cjs agency-create --name "Agency A"
node scripts/admin.cjs user-create --agency "AGENCY_ID_FROM_CREATE" --username agency-owner --role owner
node scripts/admin.cjs user-create --agency "AGENCY_ID_FROM_CREATE" --username agency-editor --role editor
node scripts/admin.cjs user-create --agency "AGENCY_ID_FROM_CREATE" --username agency-viewer --role viewer
```

Use a TTY SSH session for hidden password entry and confirmation. For noninteractive provisioning, explicitly select `--password-stdin` through a protected input channel or `--password-file` with a private single-line file. The password is 12–128 characters. Remove temporary input files privately after use. `user-reset`, `user-revoke`, `user-role`, and `sessions-revoke-all` invalidate relevant stored sessions; the last active owner is protected from removal/demotion.

Central authentication lives at `work/data/auth.sqlite`; each agency has `work/tenants/<agencyId>/scopewise.sqlite` and its own backup artifacts. A session selects its agency, not a caller-supplied agency ID. Usernames are globally unique, case-insensitively. Retained `work/data/scopewise.sqlite` is never automatically exposed to all accounts. See [explicit legacy assignment and recovery](backup-restore.md).

## Hosted acceptance still required

Record actual results rather than treating successful provider build/liveness as application acceptance:

- Confirm HTTPS for frontend and backend, anonymous minimal `/health/live`, denied direct backend API access without the proxy secret, and no unintended frontend/source/work-file exposure on Render.
- Sign in through the frontend. Check its host-only cookie flags, reload persistence, logout, reset/revoke behavior, and uncached session/workspace responses. Confirm an unrelated Origin or a missing/malformed CSRF token cannot write.
- Exercise owner/editor/viewer behavior with two separate agencies. Verify viewer write denial and distinct workspace records, including requests attempting to substitute an agency or record ID. Confirm errors do not disclose another agency's data.
- Save representative linked/costing data, restart or redeploy the backend, and compare full saved state, revision, and timestamps. Confirm the disk actually mounted at `work`, rather than accepting an ephemeral successful save.
- Create a SQLite backup bundle, transfer a protected copy off-host, and rehearse restoration into a new work directory. Check checksums, accounts, tenant selection, exact state/revisions, session invalidation, and post-restore reauthentication before switching traffic.
- Monitor backend memory, response latency, disk growth, failures, and spending. Use one Node process and one instance. Expanding to shared/horizontal database deployment requires a separate architecture change.

Render sends health probes with one verified custom domain as Host when available, otherwise the service's `onrender.com` hostname. Ensure allowed backend Host matches this. Liveness does not test cookies, authorization, isolation, or recovery. [Render health checks](https://render.com/docs/health-checks).

The separate local `node scripts/operator-check.cjs` run passed 10 real Node/SQLite scenarios for snapshots, restoration, guards, provisioning, and explicit adoption. Its fixtures are under `work/operator-checks/40a65f28-7b66-4f38-8d42-3ab774ce7560`. This evidence does not include hosted Render/Vercel checks.

## Cost and recovery limits

Prices checked against official pages on **2026-10-08**, in USD: Render's `0.5c-512mb` plan (formerly Starter) is $7/month and a persistent disk is $0.25/GB/month. The template's 1 GB backend starts around **$7.25/month**, before additional usage, workspace fees, domain/backup services, and tax. Select a larger plan if measured workload needs it. [Render pricing](https://render.com/pricing), [current and legacy compute names](https://render.com/docs/compute-plans).

Vercel Hobby is limited to personal non-commercial use. Agency use should budget an eligible commercial plan; the advertised Pro base is $20/month, with extra seats/usage potentially billed. A one-developer Pro frontend plus the small Render backend therefore has an illustrative base near **$27.25/month**, not a guaranteed invoice. No plan has been purchased. [Vercel Hobby terms](https://vercel.com/docs/plans/hobby), [Vercel pricing](https://vercel.com/pricing).

Use [backup and restore](backup-restore.md) before upgrades. Bundles made on the same disk are not independent recovery copies. Provider disk snapshots are not a substitute for application-aware SQLite backups, off-host retention, and a tested recovery procedure. Restores preserve original work directories and generate fresh session material; using managed Render secrets requires an explicit private configuration update during recovery. The application tools do not restore provider settings, domains, proxy secrets, source deployments, or unsaved browser journals.
