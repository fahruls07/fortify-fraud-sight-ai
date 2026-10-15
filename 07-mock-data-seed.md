# Fortify — PRD M7: Mock Data, Seed & Demo Controls

**Priority:** P0 (enabler for all modules) · **Build depth:** Real

## 1. Goal
One consistent, repeatable dataset that drives every screen and every Gemini call, so the demo behaves the same on every run.

## 2. Seed contents (JSON files loaded at startup)

| File | Contents |
|---|---|
| `customers.json` | Budi + ~40 synthetic customers with baselines |
| `transactions.json` | ~30 days of history per customer (normal behaviour) |
| `alerts.json` | ≥ 120 open alerts across customers (mostly LOW/MEDIUM noise) for the queue visual, plus 1 clean low-risk "control" alert |
| `sessions.json` | Device + behaviour signals per session (including Budi's attack session template) |
| `network.json` | Subgraphs for beneficiary accounts |
| `kb/*.md` | Typology playbooks + Bank Fraud Policy |
| `reason-codes.json` | Reason code catalog |
| `fallbacks/*.json` | Cached Copilot report (Budi), cached rules (two demo prompts) |

## 3. Hero entities

**Budi Santoso** — `CUST-0001`, 21, student, Jakarta, customer since 2023, risk profile LOW, account `ACC-0001` (masked •••2231), avg daily spend Rp 500.000, usual device Samsung Galaxy A54, usual hours 08:00–22:00, 4 known beneficiaries.

**Attack transfer** (submitted live from the banking app): Rp 50.000.000 to new beneficiary `ACC-BEN-7781` (other bank, account opened 9 days ago), 23:40 WIB, session `SES-9001` using the attack signals from M2 (AnyDesk, VPN, RU IP, 7 copy-paste events, 4500 ms hesitation, rooted = false, same A54 device, correct PIN).

## 4. Baseline scoring engine (deterministic, transaction-only)
Deliberately mirrors a "traditional" engine that ignores behavioural signals:

| Rule | Points |
|---|---|
| amount > 10× customer avg | +25 |
| new beneficiary | +15 |
| beneficiary account age < 30 days | +10 |
| known device | −10 |
| correct PIN / no failed attempts | −5 |

Levels: 0–29 LOW (ALLOW), 30–59 MEDIUM (HOLD), 60+ HIGH (HOLD). Budi's transfer = 35 → **MEDIUM**, HOLD, matching the script.

## 5. Signal anomaly thresholds (backend computes `anomalous`)
`isVpnDetected == true` · `ipCountry != customer.homeCountry` · `screenSharingAppDetected != null` · `copyPasteEventsOnBeneficiaryField >= 3` · `hesitationTimeMs > 3000` · `typingCadenceDeviation > 0.5` · `sessionDurationSec > 5× baseline` · `deviceRooted == true`.

## 6. Reason code catalog
`RC_AMOUNT_SPIKE`, `RC_NEW_BENEFICIARY`, `RC_YOUNG_BENEFICIARY_ACCOUNT`, `RC_SCREEN_SHARING`, `RC_COPY_PASTE_BENEFICIARY`, `RC_VPN_FOREIGN_IP`, `RC_HESITATION`, `RC_TYPING_ANOMALY`, `RC_LONG_SESSION`, `RC_DEVICE_ROOTED`, `RC_UNUSUAL_HOUR`, `RC_MULE_NETWORK`.

## 7. Demo controls (dev-only, hidden route `/demo`)
- **Reset demo:** `POST /api/demo/reset` reloads seed, clears decisions, unfreezes Budi.
- **Simulate attack:** `POST /api/demo/simulate/budi` submits the attack transfer server-side (backup if the banking app fails on stage).
- **Toggle fallback-only mode:** forces cached Gemini responses (backup if venue network is bad).

## 8. Acceptance criteria
- Reset + simulate produce identical screens every time.
- All modules read from this one dataset; no module defines its own mock values.
- No real names, account numbers or devices from any real customer.
