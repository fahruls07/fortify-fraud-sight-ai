import type { Alert } from "./types";
import type { State } from "./store";
import { publish, toRow } from "./alerts.ts";
import { matches } from "./rules/dsl.ts";
import { featuresOf } from "./rules/backtest.ts";

// UI/GraphQL status vocabulary over the stored workflow status.
export const STATUS_MAP = { New: "ACTIVE", Investigating: "ACKNOWLEDGED", Decided: "RESOLVED" } as const;
export type ViewStatus = (typeof STATUS_MAP)[keyof typeof STATUS_MAP];
export const FROM_VIEW = Object.fromEntries(Object.entries(STATUS_MAP).map(([k, v]) => [v, k])) as Record<ViewStatus, Alert["status"]>;
const SEV_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

// Which rule raised it: the most severe Active rule matching the transaction, else the baseline factors that fired.
export function ruleNameOf(s: State, a: Alert) {
  const tx = s.transactions.find((t) => t.id === a.transactionId)!, f = featuresOf(s, tx);
  const hit = s.rules.filter((r) => r.status === "Active" && matches(r.condition, f)).sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity])[0];
  if (hit) return hit.name;
  const c = s.customers.find((x) => x.id === a.customerId)!;
  const why = [tx.amount > 10 * c.avgDailySpend && "Amount spike", tx.beneficiary.isNew && "New beneficiary", tx.beneficiary.accountAgeDays < 30 && "Young beneficiary account"].filter(Boolean);
  return why.length ? `Baseline: ${why.join(" + ")}` : "Baseline score";
}

export function viewOf(s: State, a: Alert) {
  const r = toRow(s, a);
  return {
    id: a.id, ruleName: ruleNameOf(s, a), severity: a.aiLevel ?? a.baselineLevel, timestamp: a.createdAt, status: STATUS_MAP[a.status],
    score: a.baselineScore, amount: r.amount, customerName: r.customerName, maskedAccount: r.maskedAccount, beneficiary: r.beneficiary.masked,
    newBeneficiary: r.beneficiary.isNew, assignedTo: a.assignedTo || null, transactionId: a.transactionId,
    slaDueAt: a.slaDueAt ?? null, escalated: !!a.escalated, caseId: a.caseId ?? null, hitCount: (a.hits ?? []).filter((h) => h.kind === "BLACKLIST" || h.kind === "AML").length,
  };
}
export type AlertView = ReturnType<typeof viewOf>;

export interface AlertQuery { status?: ViewStatus | null; severity?: string | null; from?: string | null; to?: string | null; limit?: number | null; offset?: number | null }
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export function queryAlerts(s: State, q: AlertQuery) {
  const st = q.status ? FROM_VIEW[q.status] : null;
  const all = s.alerts.filter((a) => (!st || a.status === st) && (!q.severity || (a.aiLevel ?? a.baselineLevel) === q.severity) &&
    (!q.from || day(a.createdAt) >= q.from) && (!q.to || day(a.createdAt) <= q.to))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const off = Math.max(0, q.offset ?? 0), lim = Math.min(Math.max(1, q.limit ?? 50), 1000);
  return { total: all.length, items: all.slice(off, off + lim).map((a) => viewOf(s, a)) };
}

// Acknowledge = "I'm on it": claims the alert and moves it to Investigating. Money stays held until a decision resolves it.
export function acknowledge(s: State, id: string, actor: string): Alert | string {
  const a = s.alerts.find((x) => x.id === id);
  if (!a) return "Alert not found.";
  if (a.status !== "New") return `Alert is already ${STATUS_MAP[a.status].toLowerCase()}.`;
  a.status = "Investigating"; a.assignedTo ||= actor;
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: new Date().toISOString(), actor, entityType: "alert", entityId: id, action: "ACKNOWLEDGE", before: { alertStatus: "New" }, after: { alertStatus: "Investigating", assignedTo: a.assignedTo }, reason: null, aiRecommendation: null });
  publish("alert.updated", s, a);
  return a;
}
