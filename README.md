# Fortify PRD — Index & Build Order

Read this file first in every new agent session, before opening any individual module PRD.

## Files in this folder

| File | Module | Priority |
|---|---|---|
| `00-overview.md` | Product overview, architecture, demo-to-module map | — read first, always |
| `01-dashboard-alert-queue.md` | M1 — Dashboard & Alert Queue | P0 |
| `02-customer-360-signals.md` | M2 — Customer 360 & Risk Signals | P0 |
| `03-ai-investigation-copilot.md` | M3 — AI Investigation Copilot (core) | P0 |
| `04-decision-case-actions.md` | M4 — Decision, Case Actions & Banking Integration | P0 |
| `05-network-graph.md` | M5 — Network Graph | P1 |
| `06-nl-rule-builder.md` | M6 — Natural Language Rule Builder | P2 |
| `07-mock-data-seed.md` | M7 — Mock Data, Seed & Demo Controls | P0 (enabler) |

## Build order

Build M7 before anything else — every other module reads from its seed data and schemas. After that, follow the demo flow, not the file numbers:

1. **M7 — Mock Data, Seed & Demo Controls.** Locks entity shapes (customer, transaction, alert, session, network, reason codes) and the baseline scoring rules. Nothing else starts until this exists.
2. **M1 — Dashboard & Alert Queue.** Needs M7's alerts/transactions to render the queue and KPIs.
3. **M2 — Customer 360 & Risk Signals.** Needs M7's customers/sessions.
4. **M4 — Decision, Case Actions & Banking Integration.** Needs M1 (alert detail shell) and the scoring endpoint from M7's baseline rules.
5. **M3 — AI Investigation Copilot.** Needs M2 (signals), M7 (typology KB, reason codes), and M5's data shape for the `get_network_links` tool — build after M2 so the tools have something real to call.
6. **M5 — Network Graph.** Can be built in parallel with M3; M3's tool just needs its API contract, not its UI.
7. **M6 — Natural Language Rule Builder.** Last — depends on the reason-code catalog and DSL fields from M7, and is lowest priority if time runs out.

## Contract rule for parallel agents

The schemas in `07-mock-data-seed.md` and the API contracts in `03-ai-investigation-copilot.md` / `04-decision-case-actions.md` are the source of truth. Do not change a field name, enum value, or endpoint shape without flagging it — propose the change in your output/PR description instead of silently altering it, so other agents working in parallel don't break.

## Suggested agent split

| Agent | Scope | Primary files |
|---|---|---|
| Backend / API | M7, M3, M4, M6 | `.NET` services, Gemini orchestration, scoring |
| Console frontend | M1, M2, M5 UI | React console, dashboard, signals panel, graph viz |
| Data / seed | M7 content | JSON seed, typology playbooks, baseline thresholds |

## Session starter prompt (copy into agent)

```
Read docs/prd/README.md, then docs/prd/00-overview.md.
Current task: implement <module file>.
Treat docs/prd/07-mock-data-seed.md schemas and the API contracts in
docs/prd/03-ai-investigation-copilot.md and 04-decision-case-actions.md
as fixed. If you need a field or endpoint they don't have, say so instead
of changing them.
```
