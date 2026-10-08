# Scopewise operations model

The base workspace remains version 1. Existing clients, projects, changes, tasks, activity and settings are preserved. Loading a legacy backup adds empty operations collections only; no demonstration operations or fabricated financial data are inserted.

`Ops.normalize(state)` adds missing `state.operations` and missing collection arrays without replacing records. It rejects an invalid operations container. `Ops.validate(state)` supports the original workspace without operations and older partial operations collections, validates all present collections and optional task assignment/estimation fields, and returns the same state. Run the base Workspace validator as well.

Operations collections: sprints, milestones, issues, team, timeEntries, estimates, invoices, versions, opportunities, proposals, costPlans, expenses. IDs use the same ASCII letters/digits/underscore/hyphen format as base records and must be unique across every collection. Project-linked references must point to the same project; CRM references must share the same client. No record deletion cascades are implicit.

- Team: id, name, role, email, capacityHours (0–168/week), active.
- Sprint: id, projectId, name, goal, start/end (YYYY-MM-DD or empty), status (Planned, Active, Completed).
- Milestone: id, projectId, name, due (date or empty), status (Planned, In progress, Reached), sprintId (optional).
- Issue: id, projectId, taskId (optional), title, description, severity (Low, Medium, High, Critical), status (Open, In progress, Resolved), assigneeId (optional), createdAt; optional due.
- Time entry: id, projectId, taskId/teamId (optional), date, durationMinutes (integer 1–1440), note.
- Estimate: id, projectId, name, hours, rateMinor, currency, status (Draft, Proposed, Accepted), notes, createdAt.
- Invoice: id, projectId, number, status (Draft only), issuedDate, dueDate (date or empty), lines, currency, notes, createdAt.
- Requirement version: id, projectId, requirement, reason, createdAt, changeId (optional).
- Opportunity: id, clientId, projectId (optional), name, stage (Lead, Qualified, Proposal, Won, Lost), valueMinor, currency, notes, nextStep, createdAt.
- Proposal: id, clientId, projectId/opportunityId (optional), title, scope, lines, currency, status (Draft, Sent, Accepted, Declined), validUntil (date or empty), notes, createdAt.

Optional task fields: assigneeId referencing team, sprintId referencing a sprint in the same project, estimatedHours (0–10,000, up to three decimal places). Inactive team records may remain linked for historical accuracy.

Financial lines contain description, qty and rateMinor. Rates/values use integer minor units (100 minor units = 1 BDT/USD/EUR/GBP unit). Quantities/hours accept at most three decimal places. Multiplication uses integer arithmetic with half-up rounding per line; invoice/proposal totals sum these rounded line amounts. Unsafe integer totals, nonfinite numbers, negatives and fractional minor-unit rates are rejected. Invoice drafts do not execute payment or sending.

Each financial record stores its own currency; changing the workspace currency cannot relabel existing money. Current-currency totals and separate byCurrency summaries are exposed. Accepted estimate hours and recorded time are compared independently of currency. "Sent" proposal status records local tracking only.

`Ops.summarize(state, {today:'YYYY-MM-DD'})` returns real metrics, byProject, byTeam, byCurrency, and traceable planning alerts. Dates are calendar validated. Alerts cover unfinished overdue milestones, unresolved critical issues, planned/logged hours exceeding accepted hours, unassigned work, draft invoices exceeding same-currency accepted estimates, and open estimated work compared with weekly capacity. Capacity comparison includes open assigned work across projects; it is explicitly not a scheduled-week forecast. No statistical prediction or AI is performed.

`Ops.invoiceTotal`, `proposalTotal`, `estimateTotal`, `multiplyMinor`, `sumMinor` expose deterministic calculations; `Ops.exportProject` produces a Markdown report of current delivery and operation records. This is a local workspace model, not authentication, accounting compliance, collaboration, or a live payment system.

Run: `node tests/operations-test.cjs`.


Dates default to Asia/Dhaka; Ops.today(timeZone, now) and Ops.formatMinor(amount, currency) provide calendar-aware defaults and exact monetary text even at safe integer limits. Aggregated per-currency overflow is rejected before persistence.


## Internal project costing

Operations now also includes costPlans and expenses, for 12 collections. Older states gain only empty arrays; absent historical rates are not invented.

Team and time entries may have costRateMinor and costCurrency. Both may be absent or null together. An explicit pair requires a nonnegative safe integer rate up to 1,000,000,000,000 minor units and BDT/USD/EUR/GBP. Zero is valid. A time entry saves its own rate/currency snapshot; current team defaults never participate in historical calculations.

A cost plan has id, projectId, name, currency, budgetMinor (nullable), laborLines, expenseLines, notes and createdAt. A project has at most one plan. Each of at most 100 labor lines has description, hours (0–1,000,000, up to three decimals), rateMinor (nullable), taskId/teamId (optional). Task links belong to the same project. Each of at most 100 planned expenses has description and amountMinor.

An actual expense has id, projectId, description, category, date, amountMinor, currency and notes. Categories are Hosting, Software, Contractor, Travel and Other. Dates are validated calendar dates. IDs remain globally unique; references and aggregate overflow are rejected before persistence.

Ops.minuteCost(minutes, rateMinor) performs exact BigInt half-up rounding per entry. Ops.costPlanTotal(plan) sums rounded known labor and planned expenses. Ops.costing(state, projectId) returns planned/actual known subtotals, missing-rate coverage, per-entry reasons and independent per-currency actual totals.

plannedComplete requires all plan rates. actualComplete requires a plan currency, no unpriced time and no actual time/expense records in other currencies. budgetRemainingMinor and budgetVarianceMinor are null for incomplete actual coverage or an unset budget. planVarianceMinor also requires a complete plan. Signed overspend is retained.

Client selling estimates, invoice drafts, task estimates and team defaults are not inferred as internal costs. UI buttons explicitly copy task effort or a same-currency person rate into a plan. New time entries can use a displayed person default; saved entries are changed only through their rate field or explicit copy button.

Run node tests/costing-test.cjs for 24 focused checks. See project-costing.md for the user workflow and verification.md for actual browser evidence.
