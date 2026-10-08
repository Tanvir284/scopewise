# Current authenticated deployment coverage

Authenticated agency storage, server roles, bound read/write tokens and session races are covered by tests/security-test.cjs and tests/client-auth-test.cjs. Native operator snapshot/restore/provisioning/adoption has a separate ten-case gate. Vercel/Render configuration is prepared; real provider cookies, TLS, persistent-disk restart and off-host recovery remain pending. See verification.md and deployment.md for precise evidence. The earlier feature map below is historical local coverage, not hosted acceptance.
# Scope and evidence map

Scopewise is a local agency prototype with 48 traceable rules (30 domain, 18 review) and 12 operations collections. CostPlans and expenses extend the original ten collections. Existing records and absent historical rates survive normalization.

| Surface | Connected behavior and evidence |
| --- | --- |
| Home/projects | Real featured project, horizontal project/workflow/task shelves, card navigation, details and linked cost summary; desktop and mobile browser checks. |
| Requirements/rules | Source snapshots, deterministic drafts, linked tasks/criteria/questions and rule evidence; 19 rule scenarios, 48 configured rules, keyboard review tabs and current route inspection. |
| Task/delivery/issues | Board/list, manual statuses, estimates, person/sprint links, milestones and issue tracking; model/HTTP checks and retained actual linked QA records. |
| Team/time | Explicit person defaults and saved time-rate snapshots; 90-minute actual UI entry, rate-edit preservation, exact-cost and nullable-pair tests. |
| Project costing | Manual labor/expense plans, optional cap, actual expenses, known totals, coverage, signed remaining/variance, per-currency groups and report copy/export; 24 focused tests and actual browser QA. |
| Commercial work/CRM | Selling estimates, invoice drafts, opportunity/proposal records with independent currencies; original QA amounts retained and final redesigned routes inspected. |
| Reports/search/settings | Recorded delivery/commercial metrics, costing link, record-name search, defaults, JSON backup/merge and recovery; mobile settings overflow repaired and rechecked. |
| Persistence | SQLite snapshots/revisions, rejected stale writes, migration replay across schema expansion and protected pending drafts; 12 transport cases, backend tests and exact live restart preservation at the retained revision. |

All 16 main navigation routes loaded at desktop size. Their 320px width checks found a settings overflow, which was repaired and rechecked. Representative home, costing, project/change details, task board, CRM, finance and forms were visually inspected. Shelves and navigation were exercised by both buttons and keyboard.

Eight npm suites pass: retained planner, workspace, storage, rules, server client, operations, costing and backend. The separate four-case delayed clipboard regression also passes. Independent read-only UI/model checks cover zero-only currency groups, incomplete comparisons and current-record export.

Actual browser cost report clipboard contents were inspected. Fresh browser downloads of the latest export formats were not requested; report-generation code and current report text have verification evidence. Broader earlier creation/export checks remain historical.

This evidence does not establish every browser engine, screen reader, storage exhaustion case, language construction or production workload. No AI provider, authenticated collaboration, cloud sync, real client notification, payment execution or automatic accounting is implemented. See verification.md and project-costing.md.
