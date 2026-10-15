import type { Customer, Level, Session, Transaction } from "./types";

// 07 §4: deterministic, transaction-only baseline. Session is used only for device/PIN rules.
export function scoreBaseline(tx: Pick<Transaction, "amount" | "beneficiary">, customer: Customer, session: Pick<Session, "isNewDevice" | "pinCorrect" | "failedPinAttempts"> | null) {
  let score = 0;
  if (tx.amount > 10 * customer.avgDailySpend) score += 25;
  if (tx.beneficiary.isNew) score += 15;
  if (tx.beneficiary.accountAgeDays < 30) score += 10;
  if (session && session.isNewDevice && session.failedPinAttempts > 0) score += 15; // takeover signature: unknown device + wrong PINs
  if (session && !session.isNewDevice) score -= 10;
  if (session && session.pinCorrect && session.failedPinAttempts === 0) score -= 5;
  score = Math.max(0, score);
  const level: Level = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  return { score, level, decision: level === "LOW" ? ("ALLOW" as const) : ("HOLD" as const) };
}

// Amount escalation on top of the baseline: the baseline gives one flat +25 for "over 10x the daily spend", so a transfer
// 900x the usual amount scored like one 11x. Here the extra points grow with the multiple, and anything at or above the
// high-value threshold (Settings → General) is held for review at least as MEDIUM, however familiar the device and payee.
export function escalateAmount(r: { score: number; level: Level; decision: "ALLOW" | "HOLD" }, amount: number, avgDailySpend: number, highValue: number) {
  const ratio = amount / Math.max(avgDailySpend, 1), reasons: string[] = [];
  const extra = ratio > 200 ? 30 : ratio > 50 ? 15 : 0;
  let score = r.score + extra;
  if (extra) reasons.push(`amount is ${Math.round(ratio)}x the customer's average daily spend (+${extra})`);
  if (highValue > 0 && amount >= highValue) { score = Math.max(score, 30); reasons.push(`high-value transfer: Rp ${amount.toLocaleString("id-ID")} ≥ threshold Rp ${highValue.toLocaleString("id-ID")}`); }
  const level: Level = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  return { score, level, decision: level === "LOW" ? ("ALLOW" as const) : ("HOLD" as const), reasons };
}
