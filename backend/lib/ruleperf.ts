import type { State } from "./store";
import { featuresOf } from "./rules/backtest.ts";
import { matches, renderExpression, type Condition, type Leaf, type Rule } from "./rules/dsl.ts";

// Rule performance from analyst feedback, plus tuning suggestions. "Decided" = alerts an analyst labelled FRAUD / NOT_FRAUD.
const WINDOW = 30 * 864e5;
export interface Suggestion { kind: "tighten" | "deactivate" | "strengthen" | "unused"; text: string; condition?: Condition; expression?: string; fpRemoved?: number; fraudKept?: number }

export function rulePerformance(s: State, now = Date.now()) {
  const txs = s.transactions.filter((t) => now - Date.parse(t.createdAt) < WINDOW);
  const labelOf = new Map(s.decisions.map((d) => [s.alerts.find((a) => a.id === d.alertId)?.transactionId, d.label]));
  const totalFraud = s.decisions.filter((d) => d.label === "FRAUD").length;
  return s.rules.map((r) => {
    const hits = txs.filter((t) => matches(r.condition, featuresOf(s, t)));
    const decided = hits.filter((t) => labelOf.has(t.id)), fraud = decided.filter((t) => labelOf.get(t.id) === "FRAUD"), fp = decided.filter((t) => labelOf.get(t.id) === "NOT_FRAUD");
    return {
      ruleId: r.id, name: r.name, status: r.status, action: r.action, hits: hits.length, total: txs.length, hitRate: txs.length ? hits.length / txs.length : 0,
      decided: decided.length, fraud: fraud.length, falsePositives: fp.length, precision: decided.length ? fraud.length / decided.length : null,
      recall: totalFraud ? fraud.length / totalFraud : null, suggestions: suggest(s, r, hits.length, fraud, fp),
    };
  });
}

function suggest(s: State, r: Rule, hits: number, fraud: { id: string }[], fp: { id: string }[]): Suggestion[] {
  const out: Suggestion[] = [], decided = fraud.length + fp.length, f = (id: string) => featuresOf(s, s.transactions.find((t) => t.id === id)!);
  if (r.status === "Active" && hits === 0) out.push({ kind: "unused", text: "Active but matched no transfer in 30 days. Check the thresholds or deactivate it." });
  if (decided >= 3 && fraud.length === 0) out.push({ kind: "deactivate", text: `All ${fp.length} decided hits were false positives. Consider deactivating or rewriting this rule.` });
  const precision = decided ? fraud.length / decided : 1;
  if (decided >= 3 && fraud.length > 0 && precision < 0.6 && r.condition.all) {
    // Raise each numeric lower bound to just below the smallest value seen in confirmed fraud; keep every fraud hit.
    r.condition.all.forEach((l, i) => {
      if ((l.op !== ">" && l.op !== ">=") || typeof l.value !== "number") return;
      const minFraud = Math.min(...fraud.map((t) => Number(f(t.id)[l.field])));
      const next: Leaf = { ...l, op: ">=", value: minFraud };
      if (!(minFraud > l.value)) return;
      const cond: Condition = { all: r.condition.all!.map((x, j) => (j === i ? next : x)) };
      const removed = fp.filter((t) => !matches(cond, f(t.id))).length;
      if (removed > 0) out.push({ kind: "tighten", text: `Raise ${l.field} to ≥ ${minFraud.toLocaleString("en-US")}: removes ${removed} of ${fp.length} false positives and keeps all ${fraud.length} fraud hits.`, condition: cond, expression: renderExpression(cond), fpRemoved: removed, fraudKept: fraud.length });
    });
  }
  if (decided >= 5 && precision >= 0.9 && (r.action === "HOLD" || r.action === "CHALLENGE")) out.push({ kind: "strengthen", text: `${Math.round(precision * 100)}% of decided hits were fraud. Consider the stronger action DECLINE.` });
  return out;
}
