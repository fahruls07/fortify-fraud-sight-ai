# Fortify — PRD 00: Product Overview

**Product:** Fortify — AI-powered Fraud Investigation Console for Digital Banking
**AI persona:** Fortify Copilot
**Track:** BFSI — Intelligent Risk, Fraud & Financial Experiences
**Build window:** 4 days · **Demo:** 3 minutes
**Status:** Draft v1

---

## 1. Problem

Fraud analysts receive hundreds of alerts per day. Traditional rules/ML give a risk score without context, so each case needs 20–30 minutes of manual lookups across several systems. Scams that use a correct PIN on the customer's own device (social-engineering, screen-sharing) look "Medium Risk" to transaction-only rules, so the money leaves before anyone understands what happened.

## 2. Solution

Fortify is the back-office console behind our existing React internet banking app. Every transfer is scored **before** money moves (pre-payment decisioning). Risky transfers are held and raised as alerts. The analyst clicks **Investigate with AI** and Fortify Copilot — Gemini on Vertex AI — gathers transaction, customer, device, behavioural and network context, grounds itself on the bank's fraud typology playbooks, and returns a structured investigation report with risk level, reason codes, evidence and recommended action. The analyst decides with one click, and the decision flows back to the banking app.

## 3. Personas

| Persona | Role in demo | Need |
|---|---|---|
| **Sari** — Fraud Analyst | Primary user of Fortify | Triage fast, understand *why*, act confidently |
| **Budi** — Customer, 21, student | Victim in the scenario, uses the banking app | Protection without being blocked on normal activity |
| **Fraud Lead** (optional) | Creates new rules | Respond to new fraud patterns in minutes, not days |

## 4. Judging criteria → product focus

| Criterion | Weight | How Fortify scores |
|---|---|---|
| Technical Merit & Gen AI | 40% | Gemini on Vertex AI with tool-calling over structured data, context-augmented generation from typology playbooks, schema-enforced output, visible agent trace (M3) |
| Problem Alignment & Impact | 25% | End-to-end pre-payment hold → AI investigation → decline & freeze, money never leaves the bank (M1, M4) |
| Innovation & Creativity | 25% | Copilot that investigates and recommends, not a chatbot; NL Rule Builder; network insight (M3, M5, M6) |
| UX & Design | 10% | Simple, functional console; one-click investigation; clear report layout (all modules) |

## 5. Modules

| ID | Module | Priority | Build depth | PRD |
|---|---|---|---|---|
| M1 | Dashboard & Alert Queue | P0 | Real (on seed data) | `01-dashboard-alert-queue.md` |
| M2 | Customer 360 & Risk Signals | P0 | UI real, signals mocked | `02-customer-360-signals.md` |
| M3 | AI Investigation Copilot | **P0 — core** | 100% real Gemini | `03-ai-investigation-copilot.md` |
| M4 | Decision, Case Actions & Banking Integration | P0 | Real | `04-decision-case-actions.md` |
| M5 | Network Graph | P1 | Visual on mock links | `05-network-graph.md` |
| M6 | Natural Language Rule Builder | P2 | Gemini with canned fallback | `06-nl-rule-builder.md` |
| M7 | Mock Data, Seed & Demo Controls | P0 (enabler) | Real | `07-mock-data-seed.md` |

## 6. Architecture

```
React Internet Banking (existing)          Fortify Console (new React app)
        │  POST /api/transactions/score             │  REST + SSE
        └──────────────┬────────────────────────────┘
                       ▼
          Fortify API — .NET 10 on Cloud Run
          ├─ Scoring Engine (deterministic baseline rules)
          ├─ Alert & Case Service
          ├─ Copilot Orchestrator ── tools ──► Transaction / Profile / Device /
          │        │                           Behaviour / Network / Typology KB
          │        └──────────────► Gemini (Flash) on Vertex AI
          ├─ Rule Builder Service ─► Gemini (structured output)
          └─ In-memory store seeded from JSON (+ audit log)
```

Notes:
- **Model:** use the current Gemini Flash model available in Vertex AI (e.g. Gemini 2.5 Flash). Gemini 1.5 Flash has been retired, so do not reference it in code or narration.
- **Data store:** in-memory, loaded from JSON seed at startup, with a reset endpoint for repeatable demos. No database is required for the prototype.
- **Auth:** single hard-coded analyst user (Sari). Out of scope: SSO, RBAC.
- **Region:** deploy to `asia-southeast2` (Jakarta) where available, which supports the data-residency talking point.

## 7. Demo flow → module map

| Time | Beat | Module(s) |
|---|---|---|
| 0:00–0:30 | Hook: alert queue piling up | M1 |
| 0:30–1:15 | Budi's normal profile; Rp 50 jt transfer flagged "Medium" by baseline | M2, M1 |
| 1:15–2:00 | **Investigate with AI** → agent trace → report escalates to CRITICAL | M3 |
| 2:00–2:15 | Decline & Freeze; banking app shows transfer declined | M4 |
| 2:15–2:30 | NL Rule Builder: screen-sharing + > 10 jt rule | M6 |
| 2:30–3:00 | Architecture & impact (slide) | — |

M5 (graph) appears inside the M3 report as a supporting panel if time allows; it is not a separate demo beat.

## 8. Shared non-functional requirements

- Copilot report end-to-end ≤ 8 s (p95), with the agent trace streaming so the screen is never idle.
- Every Gemini call has a **demo-safe fallback**: a cached response for the Budi scenario, used automatically on timeout/error and flagged in logs (never silently in the UI — show a small "cached" badge in dev mode only).
- No real customer data. All names, accounts and devices are synthetic.
- All analyst actions write an audit event (who, what, when, before/after).
- AI recommends; humans decide. No automatic decline from Gemini output.

## 9. Out of scope (prototype)

Real device/behaviour SDK, real ML model training, graph database, real rule execution from generated code, multi-user/RBAC, SSO, notifications, production security hardening.

## 10. Success criteria

- The 3-minute demo runs end-to-end live three times in a row without manual intervention.
- Copilot report cites at least 5 distinct signals and at least 1 typology playbook for the Budi case.
- Decline in Fortify is reflected in the banking app within 3 s.
