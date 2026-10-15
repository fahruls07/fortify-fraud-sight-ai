# Fortify — PRD M6: Natural Language Rule Builder

**Priority:** P2 · **Build depth:** Gemini structured output with canned fallback (~20–40%) · **Demo beat:** 2:15–2:30

## 1. Goal
Show that the bank can respond to a new fraud pattern in seconds: an analyst writes a rule in plain language and gets a structured, readable detection rule.

## 2. Design decision
Generate a **JSON rule in a small constrained DSL**, never executable C# code. This is safer, easy to validate, and closer to how real rule engines work. Gemini is called with a `responseSchema`; if the call fails or the output fails validation, return the prepared canned rule for the demo sentence.

## 3. User stories
- As a Fraud Lead, I type a rule in Bahasa Indonesia and see it translated into conditions I can read.
- As a Fraud Lead, I see how many recent transactions the rule would have caught before activating it.

## 4. DSL

Allowed fields (from M2/M7 data): `amount`, `hourOfDay`, `isNewBeneficiary`, `screenSharingAppDetected`, `isVpnDetected`, `ipCountry`, `copyPasteEventsOnBeneficiaryField`, `deviceRooted`, `sharedDeviceWith`.
Operators: `>`, `>=`, `<`, `<=`, `==`, `!=`, `in`, `isNotNull`. Combinators: `all`, `any`.
Actions: `ALLOW`, `CHALLENGE`, `HOLD`, `DECLINE`.

```json
{
  "name": "Blokir screen sharing + transfer besar",
  "description": "Blokir transfer > Rp 10 juta saat aplikasi screen sharing aktif",
  "condition": { "all": [
    { "field": "screenSharingAppDetected", "op": "isNotNull" },
    { "field": "amount", "op": ">", "value": 10000000 }
  ]},
  "expression": "screenSharingAppDetected != null && amount > 10000000",
  "action": "DECLINE",
  "severity": "CRITICAL"
}
```

## 5. UI (`/rules`)
- Rules list: name, expression, action, status (Draft / Active), created by.
- "New rule" panel: textarea + **Generate Rule** button, with two example prompts as clickable chips:
  - "Buat aturan: blokir jika ada aplikasi screen sharing dan transfer > 10 juta"
  - "Blokir transaksi jika jumlah > 10 juta dan dilakukan antara jam 2-5 pagi ke rekening baru"
- Result card: readable conditions (one per line), expression (monospace), action chip.
- **Backtest** button: counts matches against seed transactions (simple in-memory evaluation of the DSL) → "Rule ini akan menangkap 4 transaksi dari 30 hari terakhir, termasuk ALT-0142 (Budi)".
- **Activate** sets status Active (stored only; the baseline scoring engine does not need to execute it for the demo).

## 6. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/rules/generate` | `{ prompt }` → rule JSON |
| POST | `/api/rules/{id}/backtest` | Match count + sample IDs |
| POST | `/api/rules` / `GET /api/rules` | Save / list |
| POST | `/api/rules/{id}/activate` | Activate |

## 7. Acceptance criteria
- The two demo prompts always produce a valid rule (live or fallback) in < 4 s.
- Unknown field names in Gemini output are rejected by validation, then fallback applies.
- Backtest of the screen-sharing rule includes Budi's transaction.

## 8. Out of scope
Rule versioning, maker-checker approval, executing active rules in the live scoring path (stretch only).
