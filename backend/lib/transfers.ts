import { publish } from "./alerts";
import { escalateAmount, scoreBaseline } from "./scoring";
import { config } from "./settings.ts";
import { getStore } from "./store";
import { runOnTransfer, runOnEvent } from "./workflowrun";
import { amlScreen, listHits, scoreEvent, type Hit, type RiskEvent } from "./intel.ts";
import { sevOf, slaDue } from "./cases.ts";
import { checkOtp, issueChallenge, sendToCustomer } from "./custchannel.ts";
import type { Alert, AuditEvent, Decision, DecisionAction, Level, Transaction } from "./types";
import { evaluateRules } from "./ruleengine.ts";
import { featuresOf } from "./rules/backtest.ts";
import { audit } from "./auditlog.ts";

export class ApiError extends Error {
  constructor(public status: number, message: string, public extra: object = {}) { super(message); }
}
export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return Response.json({ error: e.message, ...e.extra }, { status: e.status });
  throw e;
}

const pad = (n: number, w = 4) => String(n).padStart(w, "0");
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export interface TransferInput {
  customerId: string; sessionId: string; amount: number; channel?: string; deviceId?: string; ip?: string;
  beneficiary: { accountId: string; bankName: string; name: string; accountAgeDays: number };
}
const notify = (p: Promise<unknown>) => p.catch((e: Error) => console.warn("[fortify] customer message failed:", e.message)); // never blocks a decision

// 04 §3: score before money moves. ALLOW completes; HOLD parks the transfer and raises an alert.
// Validation + baseline / watchlist / AML scoring, without saving anything. Shared by the scoring API and workflow endpoints.
export function prepareTransfer(input: TransferInput) {
  const s = getStore();
  const b = input?.beneficiary;
  if (!input || !isStr(input.customerId) || !isStr(input.sessionId) || !Number.isFinite(input.amount) || input.amount <= 0 ||
      !b || !isStr(b.accountId) || !isStr(b.bankName) || !isStr(b.name) || !Number.isInteger(b.accountAgeDays) || b.accountAgeDays < 0)
    throw new ApiError(400, "invalid transfer: need customerId, sessionId, amount > 0, beneficiary{accountId, bankName, name, accountAgeDays}");
  const c = s.customers.find((x) => x.id === input.customerId);
  if (!c) throw new ApiError(400, "unknown customerId");
  const ses = s.sessions.find((x) => x.id === input.sessionId);
  if (!ses || ses.customerId !== c.id) throw new ApiError(400, "unknown sessionId for this customer");
  if (c.accountStatus === "FROZEN") throw new ApiError(403, "Your account is temporarily secured. Please call 14041.", { code: "ACCOUNT_FROZEN" });

  const now = new Date().toISOString();
  const tx: Transaction = {
    id: `TX-L${pad(s.nextTxSeq++)}`, customerId: c.id, accountId: c.accountId, sessionId: ses.id, amount: input.amount, currency: "IDR",
    createdAt: now, channel: input.channel ?? "MOBILE_APP", status: "COMPLETED",
    beneficiary: { ...b, isNew: !c.knownBeneficiaries.includes(b.accountId) },
  };
  const esc = escalateAmount(scoreBaseline(tx, c, ses), tx.amount, c.avgDailySpend, config().general.highValueAmount);
  const r = { score: esc.score, level: esc.level, decision: esc.decision };
  // Watchlists + AML on top of the baseline: a blacklist or sanctions hit always holds (HIGH); a whitelist relaxes LOW/MEDIUM only.
  const lists = listHits(s, { accounts: [c.accountId, b.accountId], beneficiaryName: b.name, deviceId: isStr(input.deviceId) ? input.deviceId : ses.deviceModel, ip: isStr(input.ip) ? input.ip : null });
  const aml = amlScreen(s, { customerName: c.name, beneficiaryName: b.name, customerId: c.id, ipCountry: ses.ipCountry, amount: tx.amount, at: now });
  const hits: Hit[] = [
    ...lists.black.map((e): Hit => ({ kind: "BLACKLIST", ref: e.id, type: e.type, value: e.value, detail: e.reason })),
    ...lists.white.map((e): Hit => ({ kind: "WHITELIST", ref: e.id, type: e.type, value: e.value, detail: e.reason })),
    ...(esc.reasons.length ? [{ kind: "THRESHOLD" as const, ref: "amount", type: "AMOUNT", value: `Rp ${tx.amount.toLocaleString("id-ID")}`, detail: esc.reasons.join("; ") }] : []),
    ...(aml.reasons.length ? [{ kind: "AML" as const, ref: aml.matches.map((m) => m.id).join(",") || "behaviour", type: aml.matches[0]?.type ?? "BEHAVIOUR", value: `score ${aml.score}`, detail: aml.reasons.join("; ") }] : []),
  ];
  if (lists.black.length || aml.hit) Object.assign(r, { score: Math.max(r.score, 80), level: "HIGH", decision: "HOLD" });
  else if (lists.white.length && r.level !== "HIGH") Object.assign(r, { decision: "ALLOW" });
  // Active Rule Builder rules on this transfer.
  const rules = evaluateRules(s.rules, featuresOf(s, tx));
  if (rules.hits.length) hits.push(...rules.hits.map((h): Hit => ({ kind: "RULE", ref: h.id, type: h.action, value: h.name, detail: h.expression })));
  return { s, c, ses, tx, r, hits, now, rules, black: lists.black.length > 0, amlHit: aml.hit };
}

export type Outcome = "BLOCK" | "CHALLENGE" | "REVIEW" | "ALLOW";
export const DECISION: Record<Outcome, "DECLINE" | "CHALLENGE" | "HOLD" | "ALLOW"> = { BLOCK: "DECLINE", CHALLENGE: "CHALLENGE", REVIEW: "HOLD", ALLOW: "ALLOW" };

// Built-in decision: rules first (DECLINE / CHALLENGE / HOLD), then baseline + watchlist + AML. An ALLOW rule is an
// exception for Low / Medium transfers without a blacklist or AML hit.
export function builtInOutcome(p: ReturnType<typeof prepareTransfer>): Outcome {
  const a = p.rules.action, risky = p.black || p.amlHit;
  if (a === "DECLINE") return "BLOCK";
  if (a === "CHALLENGE") return "CHALLENGE";
  if (a === "ALLOW" && !risky && p.r.level !== "HIGH") return "ALLOW";
  return a === "HOLD" || p.r.decision === "HOLD" ? "REVIEW" : "ALLOW";
}

const STATUS = { BLOCK: "DECLINED", CHALLENGE: "CHALLENGE_SENT", REVIEW: "HELD", ALLOW: "COMPLETED" } as const;
const SEV_LEVEL: Record<string, Level> = { CRITICAL: "HIGH", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };
// Applies an outcome: saves the transfer, raises the alert, sends OTP / customer notices, audits. Used by the scoring API
// (built-in or workflow-driven) and by published workflow endpoints.
export function commitOutcome(p: ReturnType<typeof prepareTransfer>, outcome: Outcome, actor: string, opts: { shadow?: boolean; why?: string[] } = {}) {
  const { s, c, ses, tx, hits } = p;
  tx.status = STATUS[outcome];
  s.transactions.push(tx);
  if (opts.shadow !== false) try { runOnTransfer(s, tx, c, ses, hits); } catch (e) { console.warn("[fortify] workflow shadow run failed:", (e as Error).message); } // never blocks a transfer
  let alert: Alert | undefined;
  if (outcome !== "ALLOW") {
    // A rule that forced the outcome lifts the alert to at least its severity.
    const top = p.rules.hits.filter((h) => h.action !== "ALLOW").map((h) => SEV_LEVEL[h.severity]);
    for (const l of top) if (["LOW", "MEDIUM", "HIGH"].indexOf(l) > ["LOW", "MEDIUM", "HIGH"].indexOf(p.r.level)) p.r.level = l;
    alert = raiseAlert(p, outcome === "REVIEW" ? "New" : outcome === "CHALLENGE" ? "Investigating" : "Decided");
    if (outcome === "BLOCK") alert.assignedTo = actor;
    if (outcome !== "REVIEW") audit({ actor, entityType: "alert", entityId: alert.id, action: `AUTO_${outcome}`, before: {}, after: { transactionStatus: tx.status, why: opts.why ?? p.rules.hits.map((h) => `${h.id} ${h.action}`) } });
    if (outcome === "BLOCK") { publish("alert.updated", s, alert); notify(sendToCustomer(s, c, "declined", tx)); }
    if (outcome === "CHALLENGE") notify(issueChallenge(s, tx, c));
  }
  const message = ({ BLOCK: "Transaction cancelled for your security.", CHALLENGE: "Please confirm your transaction to continue.", REVIEW: "Transaction is under review for your security", ALLOW: "Transaction processed successfully." } as const)[outcome];
  return { decision: DECISION[outcome], transactionId: tx.id, status: tx.status, message, ...(alert && { alertId: alert.id }), alert };
}

// Saves an alert for a prepared transfer (status already set on tx).
export function raiseAlert(p: ReturnType<typeof prepareTransfer>, status: Alert["status"] = "New") {
  const { s, c, tx, r, hits, now } = p;
  const alert: Alert = { id: `ALT-${pad(s.nextAlertSeq++)}`, transactionId: tx.id, customerId: c.id, createdAt: now, baselineScore: r.score, baselineLevel: r.level, status, assignedTo: "", ...(hits.length && { hits }) }; // unassigned until an analyst investigates or decides
  alert.slaDueAt = slaDue(sevOf(alert));
  s.alerts.unshift(alert);
  publish("alert.created", s, alert);
  return alert;
}

// Built-in scoring (used when no workflow is set to serve /api/transactions/score).
export function submitTransfer(input: TransferInput) {
  const p = prepareTransfer(input);
  return commitOutcome(p, builtInOutcome(p), "engine:rules");
}

// 07 §3/§7: Budi's attack transfer, server-side (backup if the banking app fails on stage).
export function simulateBudi() {
  const s = getStore();
  const t = s.attackTemplate;
  const ses = s.sessions.find((x) => x.id === "SES-9001")!;
  ses.startedAt = new Date().toISOString();
  return submitTransfer({ customerId: t.customerId, sessionId: ses.id, amount: t.amount, channel: t.channel, beneficiary: { accountId: t.beneficiary.accountId, bankName: t.beneficiary.bankName, name: t.beneficiary.name, accountAgeDays: t.beneficiary.accountAgeDays } });
}

const MESSAGES: Record<string, string> = {
  HELD: "Transaction is under review for your security",
  COMPLETED: "Transaction processed successfully.",
  RELEASED: "Transaction processed successfully.",
  CHALLENGE_SENT: "Please confirm your transaction to continue.",
  DECLINED: "Transaction cancelled for your security.",
};

export function transactionStatus(id: string) {
  const s = getStore();
  const tx = s.transactions.find((t) => t.id === id);
  if (!tx) throw new ApiError(404, "transaction not found");
  const accountStatus = s.customers.find((c) => c.id === tx.customerId)!.accountStatus;
  const frozen = tx.status === "DECLINED" && accountStatus === "FROZEN";
  const ch = s.challenges[tx.id];
  return { transactionId: tx.id, status: tx.status, accountStatus, ...(tx.status === "CHALLENGE_SENT" && ch && { challenge: { expiresAt: ch.expiresAt, attemptsLeft: ch.attemptsLeft, status: ch.status } }), message: frozen ? "Transaction cancelled. Your account has been temporarily secured. Please call 14041." : MESSAGES[tx.status] };
}

const ACTIONS: DecisionAction[] = ["APPROVE", "CHALLENGE", "DECLINE", "DECLINE_AND_FREEZE"];
const AI_EQUIVALENT: Record<DecisionAction, string> = { APPROVE: "ALLOW", CHALLENGE: "CHALLENGE", DECLINE: "DECLINE", DECLINE_AND_FREEZE: "DECLINE_AND_FREEZE" };

export function decide(alertId: string, body: { action?: string; reason?: string; label?: string }, actor = "analyst-sari") {
  const s = getStore();
  const alert = s.alerts.find((a) => a.id === alertId);
  if (!alert) throw new ApiError(404, "alert not found");
  const action = body?.action as DecisionAction;
  if (!ACTIONS.includes(action)) throw new ApiError(400, `action must be one of ${ACTIONS.join(", ")}`);
  // shortcut: CHALLENGE is not final so it takes no label; the PRD's `{ action, reason?, label }` contract says nothing about it.
  if (action !== "CHALLENGE" && body.label !== "FRAUD" && body.label !== "NOT_FRAUD") throw new ApiError(400, "label must be FRAUD or NOT_FRAUD");
  if (alert.status === "Decided") throw new ApiError(409, "alert already decided");
  const tx = s.transactions.find((t) => t.id === alert.transactionId)!;
  if (tx.status !== "HELD" && tx.status !== "CHALLENGE_SENT") throw new ApiError(409, `transaction is ${tx.status}, cannot decide`);
  const customer = s.customers.find((c) => c.id === alert.customerId)!;

  const rec = s.recommendations[alertId] ?? null;
  const followedAi = rec !== null && rec === AI_EQUIVALENT[action];
  const reason = body.reason?.trim() || null;
  if (rec !== null && !followedAi && !reason) throw new ApiError(400, "reason is required when overriding the AI recommendation");

  const snap = () => ({ alertStatus: alert.status, transactionStatus: tx.status, accountStatus: customer.accountStatus });
  const before = snap();
  tx.status = { APPROVE: "RELEASED", CHALLENGE: "CHALLENGE_SENT", DECLINE: "DECLINED", DECLINE_AND_FREEZE: "DECLINED" }[action] as Transaction["status"];
  if (action === "DECLINE_AND_FREEZE") customer.accountStatus = "FROZEN";
  alert.assignedTo ||= actor;
  alert.status = action === "CHALLENGE" ? "Investigating" : "Decided"; // M7 enum has no "Pending customer"
  const after = snap();

  const at = new Date().toISOString();
  const event = (e: Pick<AuditEvent, "entityType" | "entityId" | "action" | "before" | "after">): AuditEvent =>
    ({ id: `AUD-${pad(s.audit.length + 1)}`, at, actor, reason, aiRecommendation: rec, ...e });
  s.audit.push(event({ entityType: "alert", entityId: alert.id, action, before, after }));
  if (action === "DECLINE_AND_FREEZE")
    s.audit.push(event({ entityType: "account", entityId: customer.accountId, action: "FREEZE", before: { accountStatus: before.accountStatus }, after: { accountStatus: "FROZEN" } }));
  if (action !== "CHALLENGE") {
    const d: Decision = { alertId, action, label: body.label as Decision["label"], followedAi, reason, decidedBy: actor, decidedAt: at, amount: tx.amount };
    s.decisions.push(d);
  }
  publish("alert.updated", s, alert);
  // Real customer actions: OTP for a challenge, notices for the final outcomes.
  if (action === "CHALLENGE") notify(issueChallenge(s, tx, customer));
  else notify(sendToCustomer(s, customer, action === "APPROVE" ? "released" : action === "DECLINE" ? "declined" : "frozen", tx));
  return { alert, transaction: tx, accountStatus: customer.accountStatus, followedAi };
}

// Customer answers the OTP challenge from the banking app. Correct → transfer released; too many wrong tries → back to the analyst.
export function verifyChallenge(txId: string, body: { otp?: unknown }) {
  const s = getStore(), tx = s.transactions.find((t) => t.id === txId);
  if (!tx) throw new ApiError(404, "transaction not found");
  if (tx.status !== "CHALLENGE_SENT") throw new ApiError(409, `transaction is ${tx.status}, no challenge pending`, { code: "NO_CHALLENGE" });
  const r = checkOtp(s, txId, typeof body?.otp === "string" ? body.otp.trim() : "");
  const alert = s.alerts.find((a) => a.transactionId === txId)!;
  if (r === "ok") {
    decide(alert.id, { action: "APPROVE", label: "NOT_FRAUD", reason: "Customer confirmed the transfer with the OTP challenge" }, "customer:otp");
    return { result: "VERIFIED", ...transactionStatus(txId) };
  }
  if (r === "locked" || r === "expired") {
    alert.status = "New"; alert.escalated = false; alert.slaDueAt = slaDue(sevOf(alert)); // hand back to analysts
    s.audit.push({ id: `AUD-${pad(s.audit.length + 1)}`, at: new Date().toISOString(), actor: "customer:otp", entityType: "alert", entityId: alert.id, action: r === "locked" ? "OTP_LOCKED" : "OTP_EXPIRED", before: {}, after: { alertStatus: "New" }, reason: null, aiRecommendation: null });
    publish("alert.updated", s, alert);
    throw new ApiError(423, r === "locked" ? "Too many wrong codes. The transfer stays on hold; our team will contact you." : "The code has expired. The transfer stays on hold; our team will contact you.", { code: r === "locked" ? "OTP_LOCKED" : "OTP_EXPIRED" });
  }
  if (r === "none") throw new ApiError(409, "no challenge pending", { code: "NO_CHALLENGE" });
  throw new ApiError(400, `Wrong code. ${s.challenges[txId].attemptsLeft} attempt(s) left.`, { code: "OTP_WRONG", attemptsLeft: s.challenges[txId].attemptsLeft });
}

// Login attempts and account updates from the banking channel: scored, stored, run through workflows (shadow) and answered.
export function prepareEvent(type: RiskEvent["type"], b: Record<string, unknown>) {
  const s = getStore();
  const c = s.customers.find((x) => x.id === b?.customerId);
  if (!c) throw new ApiError(400, "unknown customerId");
  const str = (v: unknown, max = 100) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const failed = b.failedAttempts === undefined ? 0 : Number(b.failedAttempts);
  if (!Number.isInteger(failed) || failed < 0 || failed > 100) throw new ApiError(400, "failedAttempts must be an integer 0–100");
  if (type === "account_update" && !str(b.change, 40)) throw new ApiError(400, "change is required (e.g. phone, email, password, pin, device, beneficiary_add, limit, address)");
  const ipCountry = str(b.ipCountry, 2)?.toUpperCase() ?? null;
  if (ipCountry && !/^[A-Z]{2}$/.test(ipCountry)) throw new ApiError(400, "ipCountry must be a 2-letter ISO code");
  const base = { type, customerId: c.id, sessionId: str(b.sessionId, 40), deviceId: str(b.deviceId), ip: str(b.ip, 45), ipCountry, success: typeof b.success === "boolean" ? b.success : null, failedAttempts: failed, change: type === "account_update" ? str(b.change, 40) : null };
  return { s, c, e: { id: `EVT-${pad(s.nextIntelSeq++, 6)}`, at: new Date().toISOString(), ...base, ...scoreEvent(s, base) } as RiskEvent };
}
export const EVENT_MESSAGE = { DENY: "For your security this action was blocked. Please call 14041.", CHALLENGE: "Please verify it is you to continue.", ALLOW: "OK" } as const;

export function submitEvent(type: RiskEvent["type"], b: Record<string, unknown>) {
  const { s, c, e } = prepareEvent(type, b);
  s.events.unshift(e);
  if (s.events.length > 5000) s.events.length = 5000;
  try { runOnEvent(s, e, c); } catch (err) { console.warn("[fortify] workflow shadow run failed:", (err as Error).message); }
  return { eventId: e.id, decision: e.decision, score: e.score, reasons: e.reasons, message: EVENT_MESSAGE[e.decision] };
}
