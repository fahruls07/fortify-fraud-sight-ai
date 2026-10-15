# Fortify — PRD M1: Dashboard & Alert Queue

**Priority:** P0 · **Build depth:** Real on seed data · **Demo beat:** 0:00–0:30, 0:30–1:15

## 1. Goal
Show the analyst's pain at a glance (a large, growing queue) and let Sari reach Budi's alert in one click.

## 2. User stories
- As Sari, I see today's alert volume and backlog so I can prioritise my shift.
- As Sari, I see a queue sorted by risk and amount so the most dangerous cases come first.
- As Sari, I see a new alert appear live when a risky transfer is held, without refreshing.

## 3. Screen: Dashboard (`/`)

**KPI strip (4 cards):** Open alerts · Avg handling time (baseline "28 min" vs Copilot-assisted) · Amount on hold (IDR) · Amount saved today (IDR, sum of declined held transfers).

**Alert queue table:**

| Column | Notes |
|---|---|
| Alert ID | e.g. `ALT-0142` |
| Time | relative ("2 min ago") |
| Customer | name + masked account |
| Amount | IDR, formatted `Rp 50.000.000` |
| Beneficiary | masked; "NEW" chip if first-time payee |
| Baseline risk | Low / Medium / High chip (from scoring engine) |
| AI risk | empty until investigated; then Low → Critical chip |
| Status | New · Investigating · Decided |
| Action | **Investigate** button → Alert Detail |

Filters: status, baseline risk. Default sort: status = New, then amount desc.

**Live update:** subscribe to `GET /api/alerts/stream` (SSE). New alerts slide into the top row with a short highlight.

## 4. Screen: Alert Detail (`/alerts/:id`)
Container screen that hosts other modules:
- Header: alert ID, status, amount, baseline risk, held-since timer.
- Left column: Transaction summary + Customer 360 card (M2).
- Main area: **Investigate with AI** button and report (M3), network panel (M5).
- Footer / sticky bar: decision actions (M4).

## 5. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dashboard/kpis` | KPI values |
| GET | `/api/alerts?status=&risk=` | Queue list |
| GET | `/api/alerts/{id}` | Alert + transaction + customer IDs |
| GET | `/api/alerts/stream` | SSE: `alert.created`, `alert.updated` |

## 6. Data
`Alert { id, transactionId, customerId, createdAt, baselineScore, baselineLevel, aiLevel?, status, assignedTo }` — see M7 for seed.

## 7. Acceptance criteria
- Seed loads ≥ 120 open alerts so the queue looks overloaded (hook visual).
- Budi's transfer from the banking app appears at the top within 2 s of submission, baseline = **Medium**.
- Clicking Investigate opens Alert Detail in < 1 s.
- After a decision (M4), the row status and AI risk chip update live.

## 8. Out of scope
Assignment/escalation workflows, SLA timers per analyst, pagination beyond 200 rows, export.
