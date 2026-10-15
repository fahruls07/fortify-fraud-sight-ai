# Fortify — PRD M4: Decision, Case Actions & Banking Integration

**Priority:** P0 · **Build depth:** Real · **Demo beat:** 2:00–2:15

## 1. Goal
Close the loop: the analyst's decision stops the money before it leaves the bank, and the customer-facing app reflects it immediately. This is the strongest proof of Problem Alignment & Impact.

## 2. User stories
- As Sari, I accept the Copilot recommendation or override it, with one click.
- As Sari, "Decline & Freeze Account" declines the held transfer and freezes the account in one action.
- As Budi, my banking app shows the transfer was stopped for my protection.
- As a reviewer, I can see an audit trail of who decided what and whether it followed the AI.

## 3. Pre-payment decisioning (banking app integration)

```
Banking app: Budi submits transfer
 → POST /api/transactions/score
 ← { decision: "HOLD", transactionId, message }
Banking app shows "Transaksi sedang ditinjau untuk keamanan Anda"
 → polls GET /api/transactions/{id}/status every 2 s (or SSE)
Fortify: Sari clicks Decline & Freeze
 ← status: DECLINED, accountStatus: FROZEN
Banking app shows "Transaksi dibatalkan. Akun Anda kami amankan sementara. Hubungi 14041."
```

Baseline scoring (deterministic, transaction-only features — see M7) returns ALLOW below threshold, HOLD otherwise. Only HOLD creates an alert.

## 4. Actions (sticky bar on Alert Detail)

| Action | Effect on transaction | Effect on account | Alert status |
|---|---|---|---|
| Approve | RELEASED | — | Decided (false positive) |
| Challenge customer | CHALLENGE_SENT (app shows OTP/confirm screen) | — | Pending customer |
| Decline | DECLINED | — | Decided (fraud) |
| **Decline & Freeze Account** | DECLINED | FROZEN | Decided (fraud) |

- Button matching the Copilot `recommendedAction` is highlighted as primary.
- Override (choosing a different action) requires a short reason (free text, required).
- Confirmation modal for Decline & Freeze shows amount saved.
- On success: toast "Rp 50.000.000 berhasil diselamatkan", KPI "Amount saved" increments.

## 5. Feedback label
Each decision stores `label: FRAUD | NOT_FRAUD` and `followedAi: boolean`. Displayed on the dashboard as "AI agreement rate". In the pitch, this is the feedback loop that would tune rules and models in production.

## 6. Audit
Every action writes `AuditEvent { id, at, actor, entityType, entityId, action, before, after, reason, aiRecommendation }`. Screen `/audit` (simple table, newest first). Should-have; skip UI if short on time, keep the writes.

## 7. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/transactions/score` | Called by banking app on transfer |
| GET | `/api/transactions/{id}/status` | Banking app polling |
| POST | `/api/alerts/{id}/decision` | `{ action, reason?, label }` |
| GET | `/api/audit?entityId=` | Audit list |

## 8. Acceptance criteria
- Banking app shows HOLD message within 1 s of submitting Budi's transfer.
- After Decline & Freeze, banking app shows declined + frozen within 3 s.
- Frozen account cannot submit a new transfer (API returns 403 with friendly message).
- Audit row exists for the decision with `followedAi = true`.

## 9. Out of scope
Real core-banking calls, customer notifications (SMS/email), unfreeze workflow, maker-checker on decisions.
