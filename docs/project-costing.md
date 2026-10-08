# Project costing

Internal costing records how much delivery is planned to cost and how much cost has been recorded so far. Client prices, commercial estimates, invoice drafts, payments and revenue remain separate.

## Workflow

1. Optionally set an explicit internal cost per hour and currency on a person record. Blank means unknown, and zero is a valid entered cost.
2. Open Costing from the navbar, a project card/detail, Finance or Reports.
3. Create the project cost plan with its own currency and optional internal cap. Add labor hours/rates and planned non-labor expenses.
4. Use task/person copy buttons when useful. Task effort is copied without an assumed rate; a person rate must match the plan currency.
5. Record time with the rate/currency shown in the time form. An existing entry keeps its saved snapshot until you explicitly edit its rate. Changing a person default does not rewrite history or planned labor.
6. Record actual project expenses separately. Review coverage, budget remaining and actual-minus-plan variance, then copy/export the current report.

Saved plan and expense currencies are preserved. Changing workspace defaults cannot relabel old records. A new plan currency does not convert manually entered amounts.

## Calculations and uncertainty

Planned labor rounds hours × rate half-up per line. Actual labor rounds minutes × saved hourly rate ÷ 60 half-up per entry. Totals sum these rounded minor-unit amounts. Planned expenses and recorded actual expenses are distinct records.

A missing labor rate contributes no known amount and remains labeled unknown. Explicit zero contributes a known zero. Other-currency actual records remain in separate currency subtotals; no exchange rate is guessed.

Complete budget remaining is cap minus recorded actual cost. It stays unavailable when actual coverage is incomplete or the cap is unset. Actual-minus-plan variance also needs every planned labor rate. Overspend is signed. These comparisons concern entered records so far, not a forecast of future completion cost or profitability.

## Demonstrated QA fixture

| Record | Amount |
| --- | ---: |
| Planned labor: 2.5 h at 100.05 BDT | 250.13 BDT |
| Planned hosting | 50.25 BDT |
| Planned total | 300.38 BDT |
| Recorded time: 90 min at saved 100.05 BDT/h | 150.08 BDT |
| Recorded hosting expense | 25.05 BDT |
| Recorded actual total | 175.13 BDT |
| Internal cap | 400.00 BDT |
| Remaining over recorded actual | 224.87 BDT |
| Actual minus planned | −125.25 BDT |

The QA person's default was then changed to 200.00 BDT/h. The saved time and plan kept their earlier 100.05 BDT rates and the totals above remained intact. QA records are clearly labeled and retained.

## Boundaries

One cost plan per project, up to 100 labor and 100 planned expense lines, with BDT/USD/EUR/GBP supported. Costs are entered manually; no vendor lookup, automatic time tracking, exchange conversion, expense receipt verification, payment execution or accounting certification occurs. See verification.md for the actual test and browser evidence.
