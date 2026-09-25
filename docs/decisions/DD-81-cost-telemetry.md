# DD-81: Cost telemetry: zone channels report a telemetry window at most once a minute (and when they empty) to Workers Analytics Engine (production) and to a Metrics Durable Object that keeps hourly rollups for 14 days; battle rooms report each finished battle; CPU time is modelled with the 14

Status: binding under D-37 (designer may overrule).
Spec: 14.1, 14.2, R-COST-002

## Decision

Cost telemetry: zone channels report a telemetry window at most once a minute (and when they empty) to Workers Analytics Engine (production) and to a Metrics Durable Object that keeps hourly rollups for 14 days; battle rooms report each finished battle; CPU time is modelled with the 14.1 assumptions (2 ms per incoming message, 50 ms per NPC move at 128 MB) because a Worker's clock does not advance while code runs; the dashboard at /admin/cost (emails in ADMIN_EMAILS) shows cost per player-hour, per battle, per zone-hour and per heavy subscriber-month, and an hour projected above the 0.10 dollar guardrail is highlighted and logged as a cost_guardrail warning.

## Why it is the best case

14.2 asks for cost per player-hour, per battle and per zone-hour with an alert above 0.10 dollars; the Metrics object needs no external credentials, so the dashboard works locally and in production.
