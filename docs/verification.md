# Scopewise verification

Current authentication/deployment checks: 9 October 2026, Asia/Dhaka. Local Node 24.11.0; proposed native Render Node 24.21.0 remains subject to the actual provider build. No hosting purchase, public application deployment or Docker/WSL build/runtime was performed.

## Current reproducible checks

npm test passed all ten suites after the authenticated implementation and cross-tab fix. Existing feature coverage includes 48 rules/19 rule scenarios, 12 persistence scenarios, 17 operations checks and 24 costing checks.

tests/security-test.cjs passed 12 actual HTTP/SQLite groups: anonymous denial; configured Host/Origin/proxy gate; generic authentication and cookie/hash storage; empty agency initialization; owner/editor/viewer enforcement; tenant export/history/reference isolation; mixed-cookie/bound-token read rejection; CSRF/revision/JSON/prototype guards; local reverse-proxy cookie forwarding; exact restart/session persistence; damaged-tenant preservation; revocation, throttling and both expiry types; production config/log safeguards. The absolute-expiry check keeps the session active before testing its eight-hour deadline.

tests/client-auth-test.cjs passed 11 checks: no unscoped auto-import; settled-gate live binding; mismatched server-session rejection; viewer/no-journal writes; ended/same-user-rotated sessions; old queued writes/stale successful replies; stale/current unauthorized replies; normal revision queue; private Vercel transform/cache config, asset-only output and placeholder/IPv6/localhost rejection.

The separate operator-check.cjs gate passed 10 real SQLite scenarios. It covers committed-WAL backups, verified exact restore, original preservation, restored session revocation/fresh secret, checksum/path guards, private password input, role/session administration and explicit legacy adoption. This remains separate from npm test and from host acceptance.

## Current browser and preservation evidence

An isolated authenticated preview copied retained QA fixtures into agency A; agency B started empty. Browser actions verified owner sign-in/save/sign-out, same-agency viewer access, server-backed reload and separate empty agency B. After the final bound-read-token change, real sign-in/logout/viewer costing forms were rechecked.

At 320px the sign-in page fit the viewport, the signed-in app had no page overflow, and header/account controls remained reachable. Logout blanked the password, masked the app and set its inert state. Viewer text/number fields were readonly/selectable; selectors/actions and Save were disabled, with Cancel working. A breakpoint geometry check kept the account within the header. The console had no captured warning/error entries in the final targeted run.

Saved synthetic costing totals remained planned 300.38 BDT, actual 175.13 BDT and remaining 224.87 BDT, with the recorded 100.05 rate unchanged after a current 200 rate edit. These labeled fixtures are test data; no client finance data was invented.

The original unassigned legacy workspace was compared read-only to its prior capture: full state, revision and timestamp matched. The private evidence report lives in ignored outputs/ and is not part of the public source package. No production agency account or automatic legacy assignment was created.

## Required hosted evidence still missing

Actual Vercel TLS/cookie/header/cache behavior, Render disk mounting and restart/redeploy persistence, two-agency acceptance on hosted URLs, protected off-host backup/restore rehearsal and measured workload limits are unverified. Local HTTPS-host simulation over loopback HTTP does not establish these facts. Exact URLs, managed secrets, initial ownership and separate hosting authorization remain launch gates.

## Historical local feature/redesign checks

The following earlier evidence concerns the local implementation before authenticated deployment integration. It records targeted UI/model checks and is not hosted production acceptance.


# Earlier local verification

Date: 8 October 2026 (Asia/Dhaka).
Project: the repository directory.
Local preview: http://127.0.0.1:4173.

## Current costing browser evidence

Actual preview actions used the existing labeled QA Sandbox Project/Developer:

- Set a person internal rate to 100.05 BDT/h. Its old 90-minute entry stayed unpriced until an explicit rate-copy action.
- Created a project plan from the saved 2.5-hour task estimate; the copy initially retained an unknown rate.
- Explicitly copied the same-currency person rate: planned labor 250.13 BDT. Added planned hosting 50.25 BDT for a 300.38 BDT plan and an internal 400.00 BDT cap.
- Before pricing recorded time, actual coverage was incomplete and budget remaining displayed Not available.
- Explicitly priced the 90-minute entry: actual labor 150.08 BDT. Added actual hosting 25.05 BDT, giving known actual 175.13 BDT, remaining 224.87 BDT and actual-minus-plan −125.25 BDT.
- Changed the current person default to 200.00 BDT/h. Planned/recorded rates remained 100.05 BDT, preserving all totals.
- Copied the current cost report and inspected the actual clipboard text, line records, amounts, coverage and real newlines.
- Expense search displayed its real description and opened its editor. Existing plan/expense currency selectors were disabled with explanations.
- At 320px, a preview-only added labor line rejected a negative rate and displayed an explicit zero as 0.00 BDT. Its removal and dialog cancellation preserved saved records.

The commercial estimate remains 3126.25 BDT, and the invoice draft remains 300.15 BDT. These values are separate from internal costs. QA fixtures are retained and labeled; there are the labeled project/task fixtures.

## Whole-app redesign and interaction checks

The final served interface uses a black/charcoal shell, restrained red actions, a top navbar, a real featured project, code-generated project covers, horizontal shelves, consistent working views and layered forms. Public Netflix content-browsing patterns were used as a reference; Scopewise branding is retained.

Desktop visual checks used 1440×960 and the ordinary preview size. Home, project details, costing, task board, requirement review, CRM and finance were inspected. All 16 main navigation routes loaded with the shared theme. No new numeric scores or invented financial records were introduced for the redesign.

Keyboard/button checks covered shelf End/Home and arrow controls, Enter opening a project card, requirement detail ArrowRight tabs, mobile drawer opening focus on Home, Escape restoring focus to the menu, and route navigation closing/inerting the drawer. This is targeted evidence, not exhaustive accessibility certification.

Mobile checks used 390×844 and 320×760. All 16 main routes were checked for page width at 320px. Settings initially overflowed; its columns/file input were corrected and rechecked at 312px page width within the 320px viewport. Other main routes fit the same viewport. Horizontal shelves, pipelines and wide tables scroll within their own regions.

The costing dialog had 278px client/scroll width at 320px; Save ended at 743.2px inside the dialog bottom of 748px. The invoice editor had 278px client/scroll width and 241px client/scroll line width. Visible Description/Quantity/Unit rate/Line total labels and both action buttons were rechecked after the form fix. Preview-only changes were cancelled.

## Automated and independent checks

All eight npm test suites passed after the final interface changes:

| Suite | Evidence |
| --- | --- |
| Planner | Retained input, extraction/classification and literal-text behavior. |
| Workspace | Records/references, snapshots, statuses, IDs, bounded rule evidence and preferences. |
| Storage | Legacy originals, damaged recovery, quota and denied-storage behavior. |
| Rules | 19 scenarios covering 48 rules, exclusions, limits, policy, risk, Bangla and literal markup. |
| Server client | 12 migration/retry/queue/conflict/journal/cancellation scenarios. |
| Operations | 17 relationship, date, quantity, money, currency, metric and export checks. |
| Costing | 24 legacy/rate-pair/ref/rounding/unknown/zero/currency/variance/overflow/purity checks. |
| Backend | Actual isolated loopback HTTP/SQLite persistence, token/origin/static exposure, invalid writes, migrations/conflicts/replay, cross-schema replay and costing restart records. |

The separate delayed clipboard regression passed four timing cases. Syntax checks passed for workspace, operations UI and costing UI. Independent read-only UI/model audits also passed 16 editor/report scenarios and six comparison/snapshot scenarios. Those audits were in-memory and are separate from the npm suites.

A real live-server restart preserved the exact entire workspace, saved timestamp and the retained revision. The capture/check helper is work/restart-check.cjs; the captured record is work/test-artifacts/restart-before.json. Backend test databases remain isolated under work/test-artifacts.

## History and practical limits

The previous checkpoint is preserved as work/test-artifacts/verification-before-costing.md. It records earlier actual creation/planning/export workflows and the superseded visual edition. Those visual claims do not describe the final Netflix-inspired interface.

Current cost-report clipboard text was checked. Fresh browser downloads of the latest exports were not performed, and every real clipboard permission outcome is not claimed. Browser control experienced temporary timeouts, then resumed; no saved data was discarded.

No public deployment or external messaging occurred. All owned source, data, documentation and artifacts remain inside Scopewise. The local prototype has no authenticated/shared-user cloud collaboration, automatic time tracking, exchange conversion, payment execution, accounting certification or live AI. Human review is required for scope decisions; recorded-cost comparisons do not forecast remaining delivery cost. Other browser engines, all screen-reader/focus combinations, load certification and actual disk/storage exhaustion are outside these checks.
