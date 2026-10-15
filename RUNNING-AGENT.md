# Fortify — Running the Build with Claude Code

Sequential prompts, one per module, in build order. Run each in a Claude Code session opened at the repo root (`cd fortify && claude`). Do a manual browser check after each module before moving to the next — don't rely on automated visual verification.

If running multiple agents in parallel, use separate git branches per agent/module and merge manually; every agent still starts with the same first prompt below.

---

## 0. First prompt — every new session

```
Baca README.md, lalu 00-overview.md.
Ini project Fortify: AI fraud investigation console untuk hackathon BFSI,
backend dan dashboard menggunakan nextJs di Cloud Run + Gemini di Vertex AI, frontend React baru
(console) terpisah dari internet banking app yang sudah ada.
Jangan mulai coding dulu — konfirmasi kamu sudah paham arsitektur dan
urutan build M7 → M1 → M2 → M4 → M3 → M5 → M6.
```

## 1. M7 — Mock Data, Seed & Demo Controls (enabler, build first)

```
Implementasikan 07-mock-data-seed.md.
Buat struktur backend nextjs latest , seed JSON (customers, transactions,
alerts, sessions, network, kb playbooks, reason-codes, fallbacks) persis
sesuai field dan contoh di PRD, loader yang membaca JSON saat startup,
baseline scoring engine deterministik, dan endpoint demo (/api/demo/reset,
/api/demo/simulate/budi, fallback toggle).
Jangan buat modul lain. Setelah selesai, tunjukkan cara saya jalankan dan
tes endpoint-nya secara manual.
```

## 2. M1 — Dashboard & Alert Queue

```
M7 sudah ada di repo. Implementasikan 01-dashboard-alert-queue.md:
endpoint dashboard KPI, alert queue list + SSE stream, dan screen React
Dashboard + Alert Detail shell (container kosong untuk modul lain).
Gunakan kontrak data dari M7, jangan ubah skemanya.
```

## 3. M2 — Customer 360 & Risk Signals

```
Implementasikan 02-customer-360-signals.md: endpoint customer
profile, transaction history, dan session signals dengan anomaly flag
sesuai threshold di M7. Tambahkan Customer 360 card dan Session Signals
panel ke Alert Detail dari M1.
```

## 4. M4 — Decision, Case Actions & Banking Integration

```
Implementasikan 04-decision-case-actions.md: endpoint
/api/transactions/score, /api/transactions/{id}/status,
/api/alerts/{id}/decision, audit log, dan sticky action bar di Alert
Detail (Approve, Challenge, Decline, Decline & Freeze).
Juga buat integrasi sisi React internet banking app yang sudah ada:
panggil /api/transactions/score saat submit transfer, poll status,
tampilkan pesan HOLD / DECLINED / FROZEN sesuai PRD.
```

## 5. M3 — AI Investigation Copilot (core)

```
Implementasikan 03-ai-investigation-copilot.md: Copilot
Orchestrator yang memanggil tools (get_transaction, get_customer_profile,
get_session_signals, get_network_links, search_typology_playbooks),
lalu satu panggilan Gemini dengan responseSchema sesuai InvestigationReport
di PRD. Mulai dengan mode orchestration deterministik dulu (backend yang
panggil semua tool, bukan true function-calling), baru upgrade ke
tool-calling asli kalau sempat.
Tambahkan SSE trace endpoint dan report panel di Alert Detail, termasuk
fallback ke cached response Budi saat timeout/gagal validasi.
```

## 6. M5 — Network Graph

```
Implementasikan 05-network-graph.md: endpoint
/api/accounts/{id}/network dari data mock M7, dan panel graph di Alert
Detail pakai React Flow. Sambungkan juga sebagai data untuk tool
get_network_links di M3 kalau belum.
```

## 7. M6 — Natural Language Rule Builder

```
Implementasikan 06-nl-rule-builder.md: endpoint
/api/rules/generate (Gemini + responseSchema DSL, fallback canned untuk
2 prompt demo), backtest, save, activate. Screen /rules dengan textarea,
chip contoh prompt, result card, dan tombol backtest/activate.
```

---

## Manual check after each module

1. `dotnet run` (backend) dan `npm run dev` (console/banking app) di terminal terpisah.
2. Buka browser, jalankan skenario relevan modul itu secara manual.
3. Baru lanjut ke prompt modul berikutnya.

## If something breaks a contract

```
Jangan ubah skema di 07-mock-data-seed.md atau kontrak API di
03 dan 04. Kalau kamu butuh field/endpoint baru, laporkan dulu,
jangan diam-diam diubah.
```
