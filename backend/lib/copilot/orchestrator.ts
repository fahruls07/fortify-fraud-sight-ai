import { EventEmitter } from "node:events";
import { publish } from "../alerts";
import type { State } from "../store";
import type { Investigation, InvestigationReport, TraceEvent } from "../types";
import { generate, geminiConfigured } from "./gemini";
import { candidateCodes, tools } from "./tools";
import { validateReport } from "./validate";

const g = globalThis as unknown as { __fortifyInvBus?: EventEmitter };
const bus = (g.__fortifyInvBus ??= new EventEmitter().setMaxListeners(0));
export const subscribeInvestigation = (id: string, fn: (e: { type: "step" | "result" | "failed"; data: unknown }) => void) => { bus.on(id, fn); return () => bus.off(id, fn); };

const TIMEOUT_MS = 10_000; // 03 §12: cached report after 10 s
// Tools are instant on in-memory data; a short pause keeps the trace visible on stage. Set TRACE_PACE_MS=0 to disable.
const PACE_MS = Number(process.env.TRACE_PACE_MS ?? 250);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startInvestigation(s: State, alertId: string): Investigation {
  const running = Object.values(s.investigations).find((i) => i.alertId === alertId && i.status === "running");
  if (running) return running;
  const alert = s.alerts.find((a) => a.id === alertId)!;
  const inv: Investigation = { id: `INV-${String(s.nextInvSeq++).padStart(4, "0")}`, alertId, status: "running", events: [], fallback: false, startedAt: new Date().toISOString() };
  s.investigations[inv.id] = inv;
  if (alert.status === "New") { alert.status = "Investigating"; publish("alert.updated", s, alert); }
  void run(s, inv).catch((e) => fail(inv, String(e?.message ?? e)));
  return inv;
}

const t0 = (inv: Investigation) => new Date(inv.startedAt).getTime();
function step(inv: Investigation, e: Omit<TraceEvent, "at" | "ms">) {
  const ev: TraceEvent = { ...e, at: new Date().toISOString(), ms: Date.now() - t0(inv) };
  inv.events.push(ev);
  bus.emit(inv.id, { type: "step", data: ev });
}
function fail(inv: Investigation, error: string) {
  inv.status = "failed"; inv.error = error; inv.finishedAt = new Date().toISOString();
  console.log(JSON.stringify({ investigationId: inv.id, alertId: inv.alertId, status: "failed", error }));
  bus.emit(inv.id, { type: "failed", data: { error } });
}

async function run(s: State, inv: Investigation) {
  const alert = s.alerts.find((a) => a.id === inv.alertId)!;
  step(inv, { step: "plan", detail: "FraudSight Copilot is planning: transaction, profile, session signals, network, playbooks." });

  // Deterministic orchestration (03 §5 fallback mode): the backend calls every tool; Gemini only synthesizes.
  const tx = await call(inv, "get_transaction", () => tools.get_transaction(s, alert.transactionId));
  const profile = await call(inv, "get_customer_profile", () => tools.get_customer_profile(s, alert.customerId));
  const sessionId = s.transactions.find((t) => t.id === alert.transactionId)!.sessionId;
  if (!sessionId) throw new Error("transaction has no session to investigate");
  const signals = await call(inv, "get_session_signals", () => tools.get_session_signals(s, sessionId));
  const network = await call(inv, "get_network_links", () => tools.get_network_links(s, tx.beneficiary.accountId));
  const hints = candidateCodes(tx, profile, signals, network);
  const playbooks = await call(inv, "search_typology_playbooks", () => tools.search_typology_playbooks(s, hints.join(" ").toLowerCase().replace(/_/g, " "), hints));

  const toolOutputs = { transaction: tx, customerProfile: profile, sessionSignals: signals, networkLinks: network, playbooks };
  const prompt = JSON.stringify({
    task: "Investigate this alert and produce an InvestigationReport.",
    baseline: { score: alert.baselineScore, level: alert.baselineLevel, note: "the baseline engine only looks at transaction features (amount, new beneficiary, beneficiary account age, known device, PIN)" },
    toolResults: toolOutputs,
    reasonCodeCatalog: s.reasonCodes.map((r) => ({ code: r.code, title: r.title })),
  });
  const ctx = { codes: new Set(s.reasonCodes.map((r) => r.code)), toolOutputs, docIds: new Set(s.kb.map((d) => d.docId)) };

  step(inv, { step: "synthesize", detail: "FraudSight Copilot is analysing 40+ behavioural signals…" });
  const started = Date.now();
  let report: InvestigationReport | undefined;
  let reason = "";
  let tokens: number | null = null;
  let attempts = 0;
  if (s.fallbackOnly) reason = "fallback_only_mode";
  else if (!geminiConfigured()) reason = "no_credentials (GOOGLE_CLOUD_PROJECT unset)";
  else {
    const deadline = started + TIMEOUT_MS;
    let feedback = "";
    while (!report && attempts < 2 && Date.now() < deadline) { // one retry on invalid output, inside the 10 s budget
      attempts++;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), Math.max(0, deadline - Date.now()));
      try {
        const out = await generate(prompt + feedback, ac.signal);
        tokens = (tokens ?? 0) + (out.tokens ?? 0);
        const v = validateReport(JSON.parse(out.text), ctx);
        if ("report" in v) report = v.report; else { reason = `validation: ${v.error}`; feedback = `\n\nPrevious output was rejected: ${v.error}. Fix it.`; }
      } catch (e) { reason = ac.signal.aborted ? "timeout" : `gemini_error: ${(e as Error).message}`; if (ac.signal.aborted) break; }
      finally { clearTimeout(timer); }
    }
  }

  let fallback = false;
  if (!report) {
    // 07 §2: the cached report only exists for Budi's scenario; serving it for another alert would be a wrong answer.
    const cached = s.fallbacks["budi-report"] as InvestigationReport;
    if (alert.customerId !== "CUST-0001" || tx.beneficiary.accountId !== "ACC-BEN-7781") return fail(inv, `Gemini unavailable (${reason}); no cached report for this alert`);
    const v = validateReport(cached, ctx);
    if (!("report" in v)) return fail(inv, `cached report invalid: ${v.error}`);
    report = v.report; fallback = true;
  }

  inv.report = report; inv.fallback = fallback; inv.status = "done"; inv.finishedAt = new Date().toISOString();
  alert.aiLevel = report.riskLevel;
  s.recommendations[alert.id] = report.recommendedAction; // M4 reads this for followedAi / override
  publish("alert.updated", s, alert);
  console.log(JSON.stringify({ investigationId: inv.id, alertId: alert.id, fallback, reason: reason || null, attempts, tokens, latencyMs: Date.now() - t0(inv), tools: inv.events.filter((e) => e.tool).map((e) => e.tool) }));
  console.log(JSON.stringify({ investigationId: inv.id, prompt }));
  bus.emit(inv.id, { type: "result", data: { report, fallback } });
}

const TOOL_LABEL: Record<string, string> = {
  get_transaction: "Fetching transaction details…", get_customer_profile: "Fetching customer profile & baseline…", get_session_signals: "Reading device & behaviour signals…",
  get_network_links: "Checking beneficiary account network…", search_typology_playbooks: "Matching fraud typology playbooks…",
};

async function call<T>(inv: Investigation, tool: string, fn: () => T): Promise<T> {
  const out = fn();
  await sleep(PACE_MS);
  step(inv, { step: "tool", tool, detail: TOOL_LABEL[tool] ?? tool });
  return out;
}
