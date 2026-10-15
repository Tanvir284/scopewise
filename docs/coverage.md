# Current Scopewise coverage

Scopewise is an authenticated agency workspace on Netlify Free and Neon Free PostgreSQL. The latest comprehensive pass is [QA — 16 October 2026](qa-2026-10-16.md). Earlier real database and recovery evidence is in [verification](verification.md).

| Surface | Connected behavior and evidence |
| --- | --- |
| Home/projects/clients | Manual creation/linking, separate agency views, preserved original data, route/search checks. |
| Requirements/48 rules | Source snapshots, negative constraints, linked tasks/criteria/questions, approval preserving baseline; 19 rules and 11 cross-module scenarios. |
| Tasks/delivery/issues | Assignments/effort, sprint goal, reached milestone and resolved issue; actual browser edits agree with saved state and reports. |
| Team/time | Rate snapshots, manual 90-minute entry, old-rate preservation, exact rounding and filtered CSV regression. |
| Internal costing | Plans/caps, actual expenses, incomplete labor and currency groups; 24 focused tests plus browser/hosted cost assertions. |
| Finance/CRM | Independent estimates/invoice drafts, exact rounding, recorded currencies, won/declined status totals, real download and safe export regression. |
| Reports/search | Per-project/person/currency agreement, declined proposals excluded, actual linked-task search. |
| Settings/backups | Actual JSON download matches hosted state; API conflict/replay/import checks. Browser upload completion blocked by extension file permission. |
| Authentication/security | Owner/editor/viewer, CSRF/Origin/token binding, credential races, in-flight revocation, logout and agency isolation. |
| Persistence/recovery | Ordered 500-save queue, explicit conflicts, malformed-journal recovery, read-only dialogs, history consistency, local restart and validated production backup. |
| Responsive routes | All 16 routes at 320/390 viewport overrides without document-wide overflow; representative visual checks in Windows Chrome. |

All 15 script suites passed after core fixes. The final isolated export correction passed seven UI regressions and static/deployment checks. Operator gate: 10 cases. Bounded local load: 7 groups, 348 requests, up to 12 concurrent mixed operations. The full report records exact commit/test sequencing and one unreadable response with successful recovery.

This does not establish every browser/OS, physical device, assistive technology, every UI control, unlimited load, long-duration soak or provider availability. Planning requires human review; commercial records do not send messages, execute payments, convert currencies or perform automatic accounting.
