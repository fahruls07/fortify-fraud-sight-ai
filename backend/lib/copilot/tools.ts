import { networkFor } from "../network";
import { signalsView } from "../signals";
import type { State } from "../store";

// The five tools of 03 §5. Pure reads over the one seed dataset (no mock values of their own).
const hourOf = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date(iso)));
const need = <T>(v: T | undefined, what: string): T => { if (v === undefined) throw new Error(`${what} not found`); return v; };

export const tools = {
  get_transaction(s: State, transactionId: string) {
    const t = need(s.transactions.find((x) => x.id === transactionId), `transaction ${transactionId}`);
    return { transactionId: t.id, amount: t.amount, currency: t.currency, time: t.createdAt, hourOfDay: hourOf(t.createdAt), channel: t.channel, beneficiary: t.beneficiary };
  },
  get_customer_profile(s: State, customerId: string) {
    return need(s.customers.find((x) => x.id === customerId), `customer ${customerId}`);
  },
  get_session_signals(s: State, sessionId: string) {
    const ses = need(s.sessions.find((x) => x.id === sessionId), `session ${sessionId}`);
    return signalsView(ses, need(s.customers.find((c) => c.id === ses.customerId), "customer"));
  },
  get_network_links(s: State, accountId: string) {
    const n = networkFor(s, accountId);
    return { accountId, linkedAccountsCount: n.linkedAccountsCount, sharedDeviceWith: n.sharedDeviceWith, flaggedNeighbours: n.nodes.filter((x) => x.flagged).map((x) => x.id) };
  },
  // 03 §6 retrieval v1: reason-code tag match + keyword score. The policy doc is always appended: it holds the required actions.
  search_typology_playbooks(s: State, query: string, reasonCodes: string[]) {
    const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const scored = s.kb.map((d) => ({ d, score: d.tags.filter((t) => reasonCodes.includes(t)).length * 3 + words.filter((w) => d.body.toLowerCase().includes(w)).length }))
      .filter((x) => x.score > 0 && x.d.docId !== "POL-FRAUD-01").sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.d);
    const policy = s.kb.find((d) => d.docId === "POL-FRAUD-01");
    return [...scored, ...(policy ? [policy] : [])].map((d) => ({ docId: d.docId, title: d.title, snippet: d.body.slice(0, 700) }));
  },
};

// Deterministic hints used only to build the retrieval query/tags; Gemini still decides the report's reason codes.
export function candidateCodes(tx: ReturnType<typeof tools.get_transaction>, c: ReturnType<typeof tools.get_customer_profile>, sig: ReturnType<typeof tools.get_session_signals>, net: ReturnType<typeof tools.get_network_links>) {
  const out = new Set<string>();
  const bad = new Set(sig.groups.flatMap((g) => g.signals).filter((x) => x.anomalous).map((x) => x.field as string));
  const map: Record<string, string> = { isVpnDetected: "RC_VPN_FOREIGN_IP", ipCountry: "RC_VPN_FOREIGN_IP", screenSharingAppDetected: "RC_SCREEN_SHARING", copyPasteEventsOnBeneficiaryField: "RC_COPY_PASTE_BENEFICIARY", hesitationTimeMs: "RC_HESITATION", typingCadenceDeviation: "RC_TYPING_ANOMALY", sessionDurationSec: "RC_LONG_SESSION", deviceRooted: "RC_DEVICE_ROOTED" };
  for (const f of bad) if (map[f]) out.add(map[f]);
  if (tx.amount > 10 * c.avgDailySpend) out.add("RC_AMOUNT_SPIKE");
  if (tx.beneficiary.isNew) out.add("RC_NEW_BENEFICIARY");
  if (tx.beneficiary.accountAgeDays < 30) out.add("RC_YOUNG_BENEFICIARY_ACCOUNT");
  if (tx.hourOfDay < Number(c.usualActiveHours.from.slice(0, 2)) || tx.hourOfDay >= Number(c.usualActiveHours.to.slice(0, 2))) out.add("RC_UNUSUAL_HOUR");
  if (net.sharedDeviceWith >= 2) out.add("RC_MULE_NETWORK");
  return [...out];
}
