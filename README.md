# FraudSight AI — AI-Powered Fraud Investigation Console

> **BFSI Track — Intelligent Risk, Fraud & Financial Experiences**
> *Built by Team Fortify.*
>
> A back-office fraud console for digital banking. Every transfer is scored **before the money moves**; risky transfers are held and raised as alerts. The analyst runs **Investigate with AI**, and the FraudSight Copilot — Gemini with tool-calling and context-augmented generation — returns a grounded investigation report. One click decides, and the decision flows back to the banking app.

**FraudSight AI is not a chatbot.** It is an investigation console: deterministic scoring, an AI co-pilot that operates on real data, and a decision loop wired into the banking channel.

---

## Table of Contents

- [Why FraudSight AI](#why-fraudsight-ai)
- [Feature Overview](#feature-overview)
- [Architecture](#architecture)
- [How Copilot Investigates](#how-copilot-investigates)
- [Quick Start](#quick-start)
- [Demo Accounts](#demo-accounts)
- [Demo Data & Refresh](#demo-data-refresh)
- [Fraud Scenario Simulation](#fraud-scenario-simulation)
- [Banking Channel Integration](#banking-channel-integration)
- [AI Configuration (Gemini)](#ai-configuration-gemini)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [The Team](#the-team)

---

## Why FraudSight AI

**The problem.** Fraud analysts face hundreds of alerts a day. Classic rules and ML models return a risk score with no context, so every case costs 20–30 minutes of manual lookups across several systems. Scams that use a **correct PIN on the customer's own device** — social engineering, screen-sharing — look merely "Medium Risk" to transaction-only rules. The money leaves before anyone understands what happened.

**The solution.** FraudSight AI decides **before** funds move. Risky transfers are held and raised as alerts. The analyst clicks **Investigate with AI**, and Copilot:

1. gathers transaction, customer, device, behavioural and network context through tool calls;
2. grounds its analysis on the bank's fraud typology playbooks (context-augmented generation);
3. returns a schema-validated investigation report — risk level, reason codes, evidence, and a recommended action.

The analyst decides, and the decision is reflected back in the banking app.

---

## Feature Overview

### What makes FraudSight AI different

**It acts before the money leaves.** Decisions happen pre-payment: a risky transfer is held, investigated, and only then allowed to proceed. The value of fraud detection is measured in money that never left the bank.

**The AI investigates; it does not chat.** Copilot does not answer questions about fraud — it works a case. It pulls transaction, profile, session-signal, network and playbook context on its own, compares the session against that customer's own baseline, and returns a report an analyst can act on in one click. The reasoning is visible: every step streams to the screen, every reason code cites the field and value that triggered it, and the model is instructed never to invent facts outside the tool results.

**The analyst stays in charge.** Copilot recommends; a human decides. Every action is audited, and AI output alone can never decline a transfer.

### Modules

| Menu | Module | Description |
|---|---|---|
| **Command Center** | M1 | KPIs: flagged alerts, fraud detected, fraud amount, false-positive rate, trend across 24h / 7d / 30d |
| **Investigator** | M3 | AI investigation: agent trace, structured report, reason codes, recommended action |
| **Alert Queues** | M1 | Alert queue with status/severity/SLA filters and analyst assignment |
| **Customer Profiles** | M2 | Customer 360: profile, transactions, sessions, devices, risk signals |
| **Device Intelligence** | M2 | Devices, models, links to sessions and suspicious signals |
| **Connections Graph Explorer** | M5 | Network graph: customers, beneficiaries, devices, mule accounts |
| **Risk Intelligence** | M2 | Watchlists, AML screening, customer messages, risk events |
| **Cases** | M4 | Case management, event timeline, notes, attachments, SLA tracking |
| **Fraud Report** | — | Aggregate reporting, export, scheduled email delivery |
| **Rule Builder** | M6 | Author rules in **natural language** (Gemini) or via the expression editor |
| **Workflows** | M4 | Versioned decision flows with deploy and dry-run |
| **Approval Center** | — | Maker-checker control for sensitive changes |
| **Admin & Settings** | — | AI, API keys, notifications, templates, integrations |

**Engineering highlights**
- **Deterministic orchestration, generative synthesis** — the backend executes every tool call itself, so the model never guesses at inputs; Gemini's job is to reason over evidence it was actually given.
- **Schema-enforced output** — generation is constrained by a Gemini `responseSchema` and then validated server-side (enums, ranges, catalog membership, citation resolution), with one automatic retry on invalid output.
- **Context-augmented, not context-free** — the bank's own typology playbooks are retrieved and injected into the prompt, so conclusions are grounded in how this institution defines fraud.
- **Streaming agent trace** — every step is published over SSE, so the analyst watches the investigation unfold instead of waiting on a spinner.
- **Demo-safe fallback** — timeout, error or dry-run degrades to a cached report or offline mode, logged explicitly and never silently hidden.
- **Every analyst action is audited** — who, what, when, and before/after.

---

## Architecture

```
Internet Banking (React)                 FraudSight AI Console (Next.js App Router)
        │  POST /api/transactions/score            │  REST + SSE
        │  POST /api/events/login                  │  /api/alerts/stream (live queue)
        │  POST /api/events/account-update         │
        └───────────────────┬──────────────────────┘
                            ▼
              FraudSight AI Backend — Next.js route handlers
              ├─ Scoring Engine      (deterministic baseline + rule engine)
              ├─ Alert & Case Service (queue, SLA, assignment, maker-checker)
              ├─ Copilot Orchestrator ──tools──► Transaction / Profile / Session-signals /
              │        │                          Network / Typology-playbook KB
              │        └────────────► Gemini 2.5 Flash (API key or Vertex AI)
              ├─ Rule Builder Service ─► Gemini (structured output)
              └─ In-memory store loaded from JSON seed (+ audit log)
```

**Design notes**
- **In-memory data store**, loaded from JSON seed at startup — no database required for the prototype. State is persisted to `data/runtime/` (gitignored).
- **Deterministic seed** — generated with a seeded PRNG, so data is reproducible and regenerable.
- **Deployed** to Cloud Run (`asia-southeast2` / Jakarta, supporting the data-residency talking point).

**Tech stack**
- Next.js 16 (App Router) + React 19 + TypeScript
- `@google/genai` (Gemini 2.5 Flash), `@xyflow/react` (graph), `chart.js` (charts)
- `graphql-yoga` (GraphQL API), OpenAPI spec (`openapi/fortify-fraud-ib.yaml`)
- Node.js 22 (`node --test` + `--experimental-strip-types`)

---

## How Copilot Investigates

The pipeline is deliberately **deterministic where it must be, and generative where it adds value**: the backend gathers evidence through tool calls, then Gemini reasons over that evidence and the bank's own playbooks to produce a structured, validated report.

**1. Plan.** The orchestrator emits a `plan` step so the analyst sees intent, not just a result.

**2. Tool calls (5), executed over live data.**
| Tool | Returns |
|---|---|
| `get_transaction` | Amount, currency, timestamp, hour-of-day (Jakarta), channel, beneficiary |
| `get_customer_profile` | Profile and baseline behaviour for the customer |
| `get_session_signals` | 40+ device and behavioural signals, each flagged anomalous or not |
| `get_network_links` | Linked accounts, shared devices, flagged neighbours |
| `search_typology_playbooks` | Retrieval over the bank's playbook KB (tag match + keyword score; the Fraud Policy doc is always appended) |

**3. Context-augmented generation.** The retrieved playbooks are injected into the prompt *together with* the tool results, the baseline score (and an explicit note of what the baseline can and cannot see), and the full reason-code catalog. Gemini therefore reasons over the bank's own typology definitions, not its general priors.

**4. Schema-enforced output.** Generation uses a Gemini `responseSchema` with a fixed property ordering. The result is then validated server-side (`lib/copilot/validate.ts`): enums must be exact, `confidence` must be 0–1, the headline is capped at 140 characters, every `reasonCode` must exist in the catalog, and every citation must resolve to a real document. Invalid output is fed back for **one retry** inside the 10-second budget.

**5. Streaming trace.** Each step is published over SSE (`/api/alerts/stream`), so the screen is never idle — the analyst watches the agent work.

**6. Grounding rules.** The system instruction forbids inventing values: every `reasonCodes[].evidence` must name the field and value from tool results (e.g. `screenSharingAppDetected = AnyDesk`). `baselineComparison` must explain why the baseline scored as it did **and what it missed** — the exact gap that matters for social-engineering fraud.

**7. Demo-safe fallback.** On timeout, error, or missing credentials, the system serves a cached report **only for the Budi scenario** (serving it for another alert would be a wrong answer) and marks the investigation as `fallback`. Offline mode keeps the demo alive on stage.

**Output contract** (`InvestigationReport`): `riskLevel`, `confidence`, `typology`, `headline`, `summary`, `reasonCodes[] {code, severity, evidence, explanation}`, `baselineComparison`, `recommendedAction`, `nextSteps[]`, `citations[]`.

**Typologies recognised:** `SOCIAL_ENGINEERING_SCREEN_SHARING`, `MULE_ACCOUNT`, `ACCOUNT_TAKEOVER`, `PHISHING_CREDENTIAL_THEFT`, `AUTHORISED_PUSH_PAYMENT`, `NONE`.

---

## Quick Start

**Prerequisite:** Node.js 22 (recommended via `nvm`).

```bash
nvm use 22

# from the repo root
cd backend

npm install
npm run dev
```

Open **http://localhost:3000** — you'll be redirected to the sign-in page.

**Key commands**

```bash
npm run dev      # dev server (Next.js, port 3000)
npm run build    # production build
npm start        # run the production build
npm run seed     # regenerate the large seed files (customers, transactions, alerts, sessions)
npm test         # run the full unit test suite (node --test)
```

> `npm run seed` is only needed when you want to regenerate the raw seed in `data/seed/`. For day-to-day demos, just run `npm run dev` and use the **Refresh** / **Reset** controls in the console.

---

## Demo Accounts

| Username | Password | Role | Can do |
|---|---|---|---|
| `sari` | `fortify123` | Analyst / Operator | Investigate and decide alerts, author rules |
| `supervisor` | `super12345` | Checker | Approve changes (maker-checker), activate rules |
| `admin` | `admin12345` | Admin | Everything, including **Refresh/Reset demo data** and settings |

> These accounts are recreated automatically when `data/runtime/users.json` is absent. Change them for any non-public environment.

---

## Demo Data & Refresh

The dashboard filters by time window (24 hours by default). To keep a demo alive, FraudSight AI manages seed time explicitly:

- **Refresh demo data** 🔄 — the icon in the topbar next to the notification bell, visible to **admins only**.
  - Re-spreads alert and transaction timestamps across a **tiered 30-day history** (busy in the last 24 hours, tapering backwards).
  - **Does not delete** analyst work — cases, decisions, notes, investigations and the audit log all survive.
  - **Deterministic** — clicking it repeatedly yields identical results; data never accumulates.
  - Each click writes one audit entry (`REFRESH_DEMO_DATA`).

- **Reset** — `POST /api/demo/reset` restores the initial seed state (clearing cases, decisions and audit). Use this before a presentation to start from a clean slate.

Demo endpoints are **not** unauthenticated: `/api/demo/*` requires an admin session (`settings.config` permission).

---

## Fraud Scenario Simulation

`docs/scenario-requests.txt` contains **100 sample requests** covering **10 fraud scenarios** (normal, mule, account takeover, scam, high-value, risky login, and more) with their expected decisions.

```bash
curl -X POST http://localhost:3000/api/transactions/score \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <key>' \
  -d '{
    "customerId": "SCN-S01-C01",
    "sessionId": "SCN-S01-S01",
    "amount": 1500000,
    "channel": "MOBILE_APP",
    "beneficiary": {
      "accountId": "ACC-KB-S01-01-1",
      "bankName": "BNI",
      "name": "Wulan Gunawan",
      "accountAgeDays": 637
    }
  }'
```

**Decision → alert behaviour**

| Decision | Transaction status | Alert |
|---|---|---|
| `ALLOW` | `COMPLETED` | none |
| `HOLD` | `HELD` | ✅ enters the queue (status `New`) |
| `CHALLENGE` | `CHALLENGE_SENT` | ✅ alert (status `Investigating`, awaiting customer OTP) |
| `DECLINE` | `DECLINED` | ✅ alert (status `Decided`, auto-resolved) |

> **Note:** requests to `/api/events/login` and `/api/events/account-update` record **events** (visible under Risk Intelligence) rather than queue alerts. The resulting decisions depend on the workflow currently serving each endpoint.

Signals such as screen-sharing, VPN, rooted device and failed PIN are read from the **server-side session record** (via `sessionId`), never from the request body.

---

## Banking Channel Integration

Three endpoints are called by the banking app (CORS-enabled):

| Endpoint | Purpose |
|---|---|
| `POST /api/transactions/score` | Score a transfer before funds move |
| `POST /api/events/login` | Score a login attempt (`ALLOW` / `CHALLENGE` / `DENY`) |
| `POST /api/events/account-update` | Score a change to account details |

- **Spec:** `openapi/fortify-fraud-ib.yaml`
- **GraphQL:** `/api/graphql` (see `docs/graphql.md`)
- **CORS:** configured in `next.config.mjs`. Origins come from the `CORS_ORIGINS` environment variable (default `*`). Allowed headers: `Content-Type`, `X-API-Key`, `X-Fortify-Signature`.
- **API key:** can be enforced via Admin & Settings → API Configuration.

> CORS is **build-time configuration** — changes to `next.config.mjs` only take effect after a rebuild and redeploy.

---

## AI Configuration (Gemini)

Copilot uses **Gemini 2.5 Flash**. The connection can be set in two places (settings take precedence over environment variables):

1. **Admin & Settings → AI** — `API key` or `Vertex AI` mode, plus model and base URL.
2. **Environment variable fallback:**

```bash
# API key mode
GEMINI_API_KEY=your-key

# or Vertex AI mode
GOOGLE_CLOUD_PROJECT=your-project
GOOGLE_CLOUD_LOCATION=global
GEMINI_MODEL=gemini-2.5-flash
```

Without credentials, Copilot automatically degrades to **offline/fallback** mode so the demo still runs. Connection status is shown on the Settings page.

---

## Testing

```bash
cd backend
npm test
```

Runs the full unit suite (21 files, `node --test`), covering scoring, the rule engine, ACL, workflows, seed, views and more.

---

## Deployment

Example Cloud Run deployment:

```bash
gcloud run deploy fortify-fraud \
  --source backend \
  --region asia-southeast2 \
  --allow-unauthenticated \
  --set-env-vars AUTH_SECRET=<random-secret>,CORS_ORIGINS=https://<your-domain> \
  --min-instances 1 --max-instances 1
```

**Production environment variables**

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | ✅ in production | Session secret. The app **throws** in production if unset. |
| `CORS_ORIGINS` | Recommended | Allowed origins (default `*`). May list multiple origins. |
| `GEMINI_API_KEY` / `GOOGLE_CLOUD_PROJECT` | Optional | AI credentials (see above). |

**Production notes**
- `data/runtime/` is **gitignored** and written to the container filesystem. Application state is therefore ephemeral and is lost on restart/redeploy. For a short demo this is fine — the app self-heals from `data/seed/`. For persistence, mount a volume (e.g. GCS).
- Use `--max-instances 1 --min-instances 1` to keep state consistent (each instance would otherwise hold its own `state.json`) and to avoid cold starts during a live presentation.

---

## Project Structure

```
fortify-fraud-sight-ai/
├── backend/
│   ├── app/                 # Next.js App Router — pages + 79 API routes
│   │   ├── api/             # REST + SSE + GraphQL
│   │   ├── alerts/ cases/ customers/ ...   # UI pages
│   ├── components/          # 32 UI components (Shell, CopilotPanel, NetworkGraph, ...)
│   ├── lib/                 # domain logic (store, scoring, rule engine, copilot, ...)
│   │   └── copilot/         # orchestrator, gemini, tools, builder, validate
│   ├── data/
│   │   ├── seed/            # raw seed data (git-tracked, deterministic)
│   │   └── runtime/         # runtime state (gitignored)
│   ├── scripts/             # gen-seed.mjs, gen-scenarios.py
│   ├── test/                # unit tests (node --test)
│   ├── docs/                # scenario-requests.txt, graphql.md
│   ├── openapi/             # OpenAPI specification
│   ├── proxy.ts             # middleware: auth + permissions + static-asset pass-through
│   └── next.config.mjs      # banking-channel CORS configuration
├── 00-overview.md ... 07-mock-data-seed.md   # module PRDs
├── design.md
├── PRD-INDEX.md             # PRD index & build order
└── README.md
```

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Dashboard KPIs are zero | Alerts fall outside the time window (24h default). Press **Refresh demo data** (admin) or switch the range to 7d/30d. |
| Refresh button is missing | It only renders for users with `settings.config` (admin). Sign in as `admin`. |
| CORS error from the banking app | Ensure the latest build is deployed (CORS is build-time). Check `CORS_ORIGINS` and the allowed headers. |
| Public images/logo fail to load | The middleware must pass static assets through (see the `proxy.ts` matcher). |
| Copilot does not answer / is slow | Gemini credentials are missing, so the system uses offline fallback. Configure them under Settings → AI. |
| Changes to `proxy.ts` / `next.config.mjs` have no effect | Restart the dev server / rebuild (config is loaded at startup). |

---

## The Team

**Team Fortify** — the four of us built FraudSight AI end to end: a mobile banking front end, this fraud console, and the AI investigation engine behind it.

| Member | Role | Contribution |
|---|---|---|
| **Sefendy** | Backend Engineer | Fraud console (backend & UI), scoring engine, alert/case services, the Copilot investigation pipeline (Gemini tool-calling, context-augmented generation, schema validation) |
| **Andika Syahputra** | Backend Engineer & Product | Backend engineering, product ideas and concept direction, pitch deck |
| **Arif Sholehuddin** | Frontend Engineer | The M-Banking app: customer transfers, OTP flows, and the integration that routes every transfer through this backend |
| **Fahrul Sidik** | DevOps Engineer | Cloud Run deployment, CI/build pipeline, environment and runtime configuration |

**How the pieces connect.** A customer uses the M-Banking app (Arif) to make a transfer. The request is scored by the fraud console backend (Sefendy, Andika), which either allows it, challenges it, or holds it as an alert. An analyst investigates with AI, decides, and that decision is reflected straight back in the banking app — closing the loop between customer experience and fraud operations.

---

## License & Data

All names, account numbers, devices and phone numbers are **fictional** and synthetically generated. No real customer data is used. This project was built for a hackathon.