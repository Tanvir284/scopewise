# Backup and restore

The tools snapshot central authentication, every existing agency workspace, retained legacy data, and migration-backup artifacts. They preserve raw workspace JSON, saved timestamps, revision history, and workspace revisions. Authentication snapshots contain password hashes and agency assignments; treat the entire bundle as private data.

The isolated `node scripts/operator-check.cjs` run passed all 10 checks: committed WAL snapshots, exact multi-agency state/revision/savedAt restoration, session revocation without changing originals, fresh-secret generation, existing-target/offline guards, corrupt checksums, traversal rejection, password-argument redaction, explicit legacy assignment, and password-file account provisioning/revocation. Fixtures were retained at `work/operator-checks/40a65f28-7b66-4f38-8d42-3ab774ce7560`. No hosted Render/Vercel recovery has been demonstrated; it remains a separate acceptance check. Docker and WSL are not part of the selected deployment.

## Snapshot behavior

`node scripts/backup.cjs` uses SQLite `VACUUM INTO` per database, capturing committed WAL-backed data through SQLite rather than copying a possibly incomplete main file. Each database snapshot is consistent individually. Running-server writes and account changes across databases are not one global transaction. Stop all application writers for a coordinated recovery point; `--quiescent` records that operator acknowledgment but cannot independently prove the server was stopped.

The tool checks SQLite integrity, auth schema/foreign keys, workspace schemas, and revision metadata. A successful new private bundle has `payload/` and `manifest.json`, with timing, consistency mode, SHA-256 checksums, byte counts, tenant count, and workspace revision/state hashes. Readable workspace JSON exports accompany canonical SQLite snapshots.

The session secret is excluded by default. Deliberately include it with `--include-secret --secret-file FILE` if required for operator records. Restoring always removes sessions and generates a fresh secret. Browser pending journals, external client files, source code, provider configuration, managed proxy/session secret settings, and frontend deployments are outside scope. Export an unsaved browser draft before closing or recovering that browser.

Checksums detect accidental changes against a trusted manifest; they do not authenticate a bundle if someone can replace both manifest and payload. CLI bundles are not encrypted. Keep encrypted, access-controlled independent/off-host copies and rehearse recovery. Do not put bundles in public web folders or Git.

## Create a backup

Stop the local server, then run from the project directory:

```text
node scripts/backup.cjs --quiescent
node scripts/backup.cjs --work work/production --output work/backup-sets/release-before-upgrade --quiescent
```

The output directory must be new. Default names contain a timestamp and random suffix. Use `backup-sets/` outside source migration-backup directories so the bundle is not included in its own inventory.

On native Render, use a regular SSH session or Dashboard shell on the running disk-backed instance, from `/opt/render/project/src`. The source work directory is `/opt/render/project/src/work`; build/predeploy commands and isolated one-off jobs cannot access this persistent disk. A live snapshot command is:

```text
node scripts/backup.cjs --work work --output work/backup-sets/pre-upgrade
```

This live command promises individually consistent database snapshots, not a single coordinated timestamp across agencies and authentication. Do not add `--quiescent` unless all application writers actually stopped under an operator-controlled maintenance procedure. Provider maintenance redirects alone do not prove that condition. Transfer the completed bundle off-host through a protected channel; a copy left on the same disk is not independent recovery storage. [Render disk limitations and transfer](https://render.com/docs/disks), [regular SSH access](https://render.com/docs/ssh).

No secrets are printed. A failed backup preserves original data and any partial new bundle; only a completed bundle has its final valid manifest. Investigate integrity failures instead of overwriting an original database with an empty workspace. A live `individual-database-snapshots` bundle has a different consistency promise from stopped-service recovery.

## Restore into a new directory

Restore is offline, requires acknowledgment, and never replaces an existing target. Every listed file is checksummed and its database/workspace metadata checked before copying. Traversal paths, symbolic links, duplicate paths, unsupported payload kinds/auth versions, and checksum changes are rejected.

```text
node scripts/restore.cjs --bundle work/backup-sets/BUNDLE --target work/restores/verified-recovery --confirm OFFLINE-RESTORE
```

The target must not exist and must stay inside Scopewise/work. A successful restore records `restore-record.json`, preserves each workspace's exact JSON/revision/savedAt, deletes all restored authentication sessions, and generates private `secrets/session-secret`. Account records and password hashes remain; users sign in again. Secret rotation alone would not invalidate stored login sessions, so session rows are explicitly deleted from the restored copy.

A failed copy or final check leaves the new partial target for inspection. Do not start that target. Original files and the backup bundle remain untouched.

Verify accounts, agency assignments, workspace counts/revisions, costing records, and representative linked records before switching traffic. Select the new directory with `SCOPEWISE_WORK_DIR`. On Render it must remain under the existing persistent `/opt/render/project/src/work` mount, for example `/opt/render/project/src/work/restores/verified-recovery`. Keep original directories available for deliberate rollback. Complete offline recovery locally with Node when hosted maintenance cannot guarantee stopped writers, then use a protected transfer and a reviewed host cutover.

The restored private `secrets/session-secret` does not automatically replace a managed Render `SCOPEWISE_SESSION_SECRET`. During cutover, privately update that managed value, or remove its managed/Blueprint generation setting and select `SCOPEWISE_SESSION_SECRET_FILE` at the fresh restored file. Do not configure both sources. Keep the independent Render/Vercel `SCOPEWISE_PROXY_SECRET` pair synchronized. Restored session rows are removed regardless of secret selection; require users to sign in again. Protect recovery files with Unix mode 600 and private directories on the host.

Migration ledgers and historical backup artifacts are retained. Old legacy ledgers may use historical path conventions; they must not read another agency's files. Recovery preserves saved state/revision, not an external browser's pending edit or an in-flight HTTP request.

## Assign retained legacy data to one agency

Retained `work/data/scopewise.sqlite` is not automatically visible to authenticated users. Stop writers, create a named agency, and explicitly assign it before that agency's first login:

```text
node scripts/admin.cjs agency-create --name "Agency receiving legacy records"
node scripts/admin.cjs adopt-legacy --agency "AGENCY_ID_FROM_CREATE" --confirm-agency "AGENCY_ID_FROM_CREATE"
```

Use `--work` consistently when selecting another work directory containing the retained database. The command refuses an existing tenant database and does not merge into an initialized agency. It snapshots to a staged file, checks exact state/revision/timestamp, and publishes only a fresh tenant database without replacing a file. The original legacy database stays intact; legacy backup artifacts are copied into that tenant's `backups/legacy-preserved/`. An adoption record identifies the agency and source revision.

This assigns an entire legacy workspace to one agency; it neither splits records among agencies nor infers ownership from clients. Review the content before assigning it. Provision its users separately with `user-create --agency ID --role owner|editor|viewer`, using hidden password input or an explicitly selected private file/pipe.

## Limits

The tools use current application validators and auth schema version 1. They provide no automatic downgrade, damaged-database repair, incremental/encrypted backup format, or scheduled remote backup service. Disk capacity, retention, protected transfer, and off-host availability remain operator responsibilities. Application snapshots alone cannot restore DNS, provider accounts/settings, managed secrets, frontend routing, or the host.
