import { networkFor } from "../network.ts";
import type { State } from "../store";
import type { Transaction } from "../types";
import { matches, type Features, type Rule } from "./dsl.ts";

const WINDOW_DAYS = 30;
const hourOf = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date(iso)));

// Rule features for one transaction. History rows have no session, so they get the customer's normal-session defaults.
export function featuresOf(s: State, t: Transaction): Features {
  const c = s.customers.find((x) => x.id === t.customerId)!;
  const ses = s.sessions.find((x) => x.id === t.sessionId);
  return {
    amount: t.amount, hourOfDay: hourOf(t.createdAt), isNewBeneficiary: t.beneficiary.isNew,
    screenSharingAppDetected: ses?.screenSharingAppDetected ?? null, isVpnDetected: ses?.isVpnDetected ?? false,
    ipCountry: ses?.ipCountry ?? c.homeCountry, copyPasteEventsOnBeneficiaryField: ses?.copyPasteEventsOnBeneficiaryField ?? 0,
    deviceRooted: ses?.deviceRooted ?? false, sharedDeviceWith: networkFor(s, t.beneficiary.accountId).sharedDeviceWith,
  };
}

// 06 §5: in-memory evaluation over seed transactions. History rows have no session, so they get the customer's normal-session defaults.
export function backtest(s: State, rule: Rule) {
  const since = Date.now() - WINDOW_DAYS * 864e5;
  const txs = s.transactions.filter((t) => new Date(t.createdAt).getTime() >= since);
  const hits = txs.filter((t) => matches(rule.condition, featuresOf(s, t)));
  const alertOf = (txId: string) => s.alerts.find((a) => a.transactionId === txId)?.id;
  return {
    ruleId: rule.id, windowDays: WINDOW_DAYS, matched: hits.length, total: txs.length,
    sampleTransactionIds: hits.slice(0, 10).map((t) => t.id), alertIds: hits.map((t) => alertOf(t.id)).filter(Boolean).slice(0, 10),
  };
}
