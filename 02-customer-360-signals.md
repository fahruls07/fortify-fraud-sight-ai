# Fortify — PRD M2: Customer 360 & Risk Signals (Behavioural Biometrics & Device Intelligence)

**Priority:** P0 · **Build depth:** UI real, signals mocked (~80%) · **Demo beat:** 0:30–1:15

## 1. Goal
Establish Budi's **normal** behaviour, then expose the raw signals of the suspicious session. The signals are what make the solution feel enterprise-grade and what the Copilot (M3) reasons over.

## 2. Principle
No real SDK or tracker. Signals are mock JSON in the .NET backend, attached to the session that produced the transaction. The UI must make clear these come from the "device & behaviour layer" (in the pitch: "in production, captured by the bank's risk SDK").

## 3. User stories
- As Sari, I see who the customer normally is (device, location, typical amount) in one card.
- As Sari, I see this session's device and behaviour signals, with abnormal values highlighted against baseline.

## 4. UI

**Customer 360 card** (on Alert Detail and `/customers/:id`):
- Name, age, segment ("Student"), customer since, risk profile (Low).
- Baseline: usual device (Samsung Galaxy A54), usual location (Jakarta), avg daily spend (Rp 500.000), usual active hours (08:00–22:00), known beneficiaries count.
- Last 10 transactions mini-table.

**Session Signals panel** — two groups, each row shows value + baseline + status dot (normal / anomalous):

| Group | Field | Budi session value | Baseline |
|---|---|---|---|
| Device intelligence | `deviceModel` | Samsung Galaxy A54 | same |
| | `deviceRooted` | false | false |
| | `isVpnDetected` | true | false |
| | `ipCountry` | RU | ID |
| | `screenSharingAppDetected` | "AnyDesk" | null |
| | `isNewDevice` | false | — |
| Behavioural biometrics | `copyPasteEventsOnBeneficiaryField` | 7 | 0 |
| | `hesitationTimeMs` | 4500 | ~800 |
| | `typingCadenceDeviation` | 0.82 | < 0.2 |
| | `sessionDurationSec` | 1260 | ~180 |
| | `navigationPattern` | "direct-to-transfer" | "browse-then-transfer" |

Note: the scenario script says 7 copy-paste events; keep the seed and narration consistent (use 7 everywhere).

## 5. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/customers/{id}` | Profile + baseline |
| GET | `/api/customers/{id}/transactions?limit=10` | History |
| GET | `/api/sessions/{sessionId}/signals` | Device + behaviour signals with baseline comparison |

Response for signals includes `anomalous: boolean` per field, computed in backend by simple thresholds (defined in M7), so UI does no logic.

## 6. Acceptance criteria
- Budi's card shows the normal profile exactly as in the script (A54, Jakarta, Rp 500rb).
- At least 5 signals render as anomalous for the Budi session.
- The same signals are the input to M3 tools (single source of truth — no duplicate mock).

## 7. Out of scope
Real-time SDK, signal history charts, editing profiles.
