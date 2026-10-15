# Fortify — PRD M3: AI Investigation Copilot

**Priority:** P0 — core of the product · **Build depth:** 100% real Gemini on Vertex AI · **Demo beat:** 1:15–2:00 ("WOW" moment)

## 1. Goal
One click turns scattered raw data into an evidence-backed investigation report: risk level, typology, reason codes with evidence, and a recommended action. This module carries the 40% Technical Merit & Gen AI criterion and most of the 25% Innovation criterion.

## 2. What makes it a Copilot, not a chatbot
1. **Agentic tool use.** Gemini is given tools and decides which data to fetch; it is not handed one big prompt.
2. **Context-augmented generation.** Gemini is grounded on the bank's fraud typology playbooks and policy thresholds, and cites them.
3. **Structured, validated output.** Response is schema-enforced JSON, validated server-side, then rendered — not free text.
4. **Visible reasoning trace.** The UI streams each step ("Fetching device signals… Matching typology…") so judges see the agent work.
5. **Human-in-the-loop.** Copilot recommends; Sari decides (M4).

## 3. User stories
- As Sari, I click **Investigate with AI** and get a report in seconds instead of opening five systems.
- As Sari, every claim in the report points to a concrete signal value, so I can trust and defend it.
- As Sari, I see which playbook the case matches and what policy says to do.

## 4. Flow

```
Click "Investigate with AI"
 → POST /api/alerts/{id}/investigate      (returns investigationId)
 → GET  /api/investigations/{id}/stream   (SSE)
     step: plan
     step: tool get_transaction
     step: tool get_customer_profile
     step: tool get_session_signals
     step: tool get_network_links
     step: tool search_typology_playbooks
     step: synthesize
     result: InvestigationReport JSON
```

## 5. Tools exposed to Gemini (function calling)

| Tool | Args | Returns |
|---|---|---|
| `get_transaction` | transactionId | amount, time, channel, beneficiary (isNew, bank, account age) |
| `get_customer_profile` | customerId | profile + baseline (M2) |
| `get_session_signals` | sessionId | device + behaviour signals with anomaly flags (M2) |
| `get_network_links` | accountId | linkedAccountsCount, sharedDeviceWith, flagged neighbours (M5) |
| `search_typology_playbooks` | query, reasonCodes[] | top 2–3 playbook snippets with `docId` |

**Fallback orchestration mode:** if function calling is unstable, the backend calls all five tools deterministically, assembles the context, and makes one Gemini call. The SSE trace looks identical. Implement this first, then upgrade to true tool-calling if Day 2 allows.

## 6. Context-augmented generation (knowledge base)
- 5–6 markdown playbooks in the backend: Social-Engineering / Screen-Sharing Scam, Mule Account, Account Takeover, Phishing / Credential Theft, Authorised Push Payment Scam, plus a **Bank Fraud Policy** doc (thresholds and required actions).
- Retrieval v1: tag match on reason codes + keyword score (in-memory). Retrieval v2 (stretch): Vertex AI text embeddings or Vertex AI Search.
- Each snippet carries `docId` and `title`; the report must cite at least one.

## 7. Output schema (`InvestigationReport`)

```json
{
  "riskLevel": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": 0.0,
  "typology": "SOCIAL_ENGINEERING_SCREEN_SHARING",
  "headline": "string, ≤ 140 chars",
  "summary": "string, 3–5 sentences, Bahasa Indonesia",
  "reasonCodes": [
    { "code": "RC_SCREEN_SHARING", "severity": "CRITICAL", "evidence": "screenSharingAppDetected = AnyDesk", "explanation": "string" }
  ],
  "baselineComparison": "string — why baseline said MEDIUM and what it missed",
  "recommendedAction": "ALLOW | CHALLENGE | HOLD | DECLINE | DECLINE_AND_FREEZE",
  "nextSteps": ["string"],
  "citations": [{ "docId": "PB-SCAM-01", "title": "string" }]
}
```

Enforced via Gemini `responseSchema` (JSON mode). Server validation: reasonCodes must be in the catalog (M7); evidence must reference a field that exists in tool output; on failure, retry once, then fallback.

Language: report text in **Bahasa Indonesia** (matches demo narration); codes and enums in English.

## 8. Prompt requirements (system instruction)
- Role: senior fraud investigator at an Indonesian bank.
- Use only facts from tool results; never invent values.
- Compare session against customer baseline explicitly.
- Map to a playbook and cite it.
- Recommend an action consistent with the Bank Fraud Policy doc.
- Temperature low (≈ 0.2) for consistent demo output.

## 9. UI — report panel
- Header: AI risk chip (large), typology, confidence, recommended action button-styled tag ("CRITICAL — DECLINE").
- Headline in bold, then summary.
- Reason code list: severity icon, code, evidence value (monospace), explanation.
- "Baseline vs AI" callout: Medium → Critical, and why.
- Citations as chips that open the playbook snippet in a side drawer.
- Agent trace collapsible above the report, with step timings.
- Loading copy: "Fortify Copilot menganalisis 40+ sinyal perilaku…".

## 10. Expected demo output (Budi)
riskLevel CRITICAL, typology SOCIAL_ENGINEERING_SCREEN_SHARING, recommendedAction DECLINE_AND_FREEZE, reason codes at minimum: RC_SCREEN_SHARING, RC_COPY_PASTE_BENEFICIARY, RC_VPN_FOREIGN_IP, RC_AMOUNT_SPIKE (100× average), RC_NEW_BENEFICIARY, RC_HESITATION, plus RC_MULE_NETWORK if M5 data present.

## 11. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/alerts/{id}/investigate` | Start investigation |
| GET | `/api/investigations/{id}/stream` | SSE trace + result |
| GET | `/api/investigations/{id}` | Final report (for reload) |
| GET | `/api/kb/{docId}` | Playbook snippet |

## 12. Non-functional
- p95 ≤ 8 s end-to-end; first trace event ≤ 500 ms.
- Cached Budi report used on timeout (10 s) or validation failure, logged as `fallback=true`.
- Log prompt, tool calls, tokens and latency per investigation (useful for the "governance" talking point).
- No PII beyond synthetic data is sent to Gemini.

## 13. Acceptance criteria
- Live (non-cached) Gemini call produces a valid report for Budi in ≥ 4 of 5 runs.
- Report cites ≥ 5 signals and ≥ 1 playbook.
- A low-risk seed alert (normal transfer) yields LOW / ALLOW — proves the AI is not hard-coded to say Critical.

## 14. Out of scope
Free-form chat, multi-turn follow-up questions (stretch: one "Ask Copilot" follow-up box), model fine-tuning.
