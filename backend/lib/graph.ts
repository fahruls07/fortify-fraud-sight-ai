import type { State } from "./store";
import { networkFor } from "./network.ts";

// Connections graph for a beneficiary account, built from transaction history: who sent money to it (amount, count, outcome),
// where it moved money on (mule network), and the attributes involved (bank, name, devices, IP countries). Blocklisted
// attributes come from the watchlist.
export type GNodeKind = "center" | "sender" | "onward" | "bank" | "name" | "device" | "country";
export interface GNode { id: string; kind: GNodeKind; label: string; sub?: string; flagged: boolean; blocked: boolean; count?: number }
export interface GTx { id: string; at: string; amount: number; status: string; alertId?: string; outcome?: string; risk?: string }
export interface GEdge { id: string; source: string; target: string; kind: "transfer" | "onward" | "attribute" | "shared_device"; amount: number; count: number; fraud: boolean; txs: GTx[] }
export interface TimelineItem { at: string; kind: "transfer" | "alert" | "decision" | "watchlist"; text: string; risk?: string; ref?: string }

export function accountGraph(s: State, accountId: string) {
  const now = Date.now();
  const listed = (type: string, v: string) => s.watchlist.some((e) => e.list === "BLACK" && e.type === type && (!e.expiresAt || Date.parse(e.expiresAt) > now) && e.value.trim().toUpperCase() === v.trim().toUpperCase());
  const txs = s.transactions.filter((t) => t.beneficiary.accountId === accountId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const alertOf = new Map(s.alerts.map((a) => [a.transactionId, a]));
  const decisionOf = new Map(s.decisions.map((d) => [d.alertId, d]));
  const tx = (t: (typeof txs)[number]): GTx => {
    const a = alertOf.get(t.id), d = a && decisionOf.get(a.id);
    return { id: t.id, at: t.createdAt, amount: t.amount, status: t.status, ...(a && { alertId: a.id, risk: a.aiLevel ?? a.baselineLevel }), ...(d && { outcome: d.label }) };
  };
  const ben = txs.at(-1)?.beneficiary;
  const nodes = new Map<string, GNode>(), edges: GEdge[] = [];
  const node = (n: GNode) => { const o = nodes.get(n.id); if (o) { o.count = (o.count ?? 1) + 1; o.flagged ||= n.flagged; o.blocked ||= n.blocked; } else nodes.set(n.id, { ...n, count: 1 }); };
  const net = networkFor(s, accountId);
  const centerFlagged = txs.some((t) => tx(t).outcome === "FRAUD") || net.nodes.some((n) => n.id === accountId && n.flagged);
  nodes.set(accountId, { id: accountId, kind: "center", label: ben?.name ?? "Beneficiary account", sub: accountId, flagged: centerFlagged, blocked: listed("ACCOUNT", accountId) || (!!ben && listed("BENEFICIARY", ben.name)) });

  // Senders: one node per customer, one aggregated edge with its transfer history.
  const bySender = new Map<string, typeof txs>();
  for (const t of txs) bySender.set(t.customerId, [...(bySender.get(t.customerId) ?? []), t]);
  for (const [cid, list] of bySender) {
    const c = s.customers.find((x) => x.id === cid)!, h = list.map(tx), fraud = h.some((x) => x.outcome === "FRAUD");
    node({ id: `cust:${cid}`, kind: "sender", label: c.name, sub: c.maskedAccount, flagged: fraud, blocked: listed("ACCOUNT", c.accountId) });
    edges.push({ id: `tx:${cid}`, source: `cust:${cid}`, target: accountId, kind: "transfer", amount: list.reduce((n, t) => n + t.amount, 0), count: list.length, fraud, txs: h });
    // Devices and IP countries those transfers came from.
    for (const t of list) {
      const ses = s.sessions.find((x) => x.id === t.sessionId);
      if (!ses) continue;
      node({ id: `dev:${ses.deviceModel}`, kind: "device", label: ses.deviceModel, sub: ses.deviceRooted ? "rooted" : ses.isNewDevice ? "new device" : undefined, flagged: ses.deviceRooted || !!ses.screenSharingAppDetected, blocked: listed("DEVICE", ses.deviceModel) });
      if (!edges.some((e) => e.id === `dev:${cid}:${ses.deviceModel}`)) edges.push({ id: `dev:${cid}:${ses.deviceModel}`, source: `cust:${cid}`, target: `dev:${ses.deviceModel}`, kind: "attribute", amount: 0, count: 1, fraud: false, txs: [] });
      if (ses.ipCountry !== c.homeCountry) {
        node({ id: `ip:${ses.ipCountry}`, kind: "country", label: `IP ${ses.ipCountry}`, sub: ses.isVpnDetected ? "VPN" : undefined, flagged: true, blocked: false });
        if (!edges.some((e) => e.id === `ip:${cid}:${ses.ipCountry}`)) edges.push({ id: `ip:${cid}:${ses.ipCountry}`, source: `cust:${cid}`, target: `ip:${ses.ipCountry}`, kind: "attribute", amount: 0, count: 1, fraud: false, txs: [] });
      }
    }
  }
  // Onward flows and shared-device links from the network intelligence feed.
  for (const n of net.nodes) if (n.id !== accountId && n.type !== "customer" && n.type !== "beneficiary")
    node({ id: `acc:${n.id}`, kind: "onward", label: n.label, sub: n.id, flagged: n.flagged, blocked: listed("ACCOUNT", n.id) });
  for (const e of net.edges) {
    const src = e.source === accountId ? accountId : `acc:${e.source}`, dst = e.target === accountId ? accountId : `acc:${e.target}`;
    if (!nodes.has(src) || !nodes.has(dst)) continue;
    edges.push({ id: `net:${e.source}:${e.target}`, source: src, target: dst, kind: e.type === "SHARED_DEVICE" ? "shared_device" : "onward", amount: e.amount ?? 0, count: 1, fraud: !!nodes.get(dst)?.flagged, txs: [] });
  }
  // Static attributes of the beneficiary.
  if (ben) {
    node({ id: `bank:${ben.bankName}`, kind: "bank", label: ben.bankName, flagged: false, blocked: false });
    edges.push({ id: "attr:bank", source: accountId, target: `bank:${ben.bankName}`, kind: "attribute", amount: 0, count: 1, fraud: false, txs: [] });
    node({ id: "attr:age", kind: "name", label: `Account age ${ben.accountAgeDays} d`, sub: ben.accountAgeDays < 30 ? "new account" : undefined, flagged: ben.accountAgeDays < 30, blocked: false });
    edges.push({ id: "attr:agee", source: accountId, target: "attr:age", kind: "attribute", amount: 0, count: 1, fraud: false, txs: [] });
  }

  const timeline: TimelineItem[] = [];
  for (const t of txs) {
    const c = s.customers.find((x) => x.id === t.customerId)!, a = alertOf.get(t.id), d = a && decisionOf.get(a.id);
    timeline.push({ at: t.createdAt, kind: "transfer", text: `${c.name} sent Rp ${t.amount.toLocaleString("id-ID")} (${t.status.toLowerCase()})`, ref: t.id });
    if (a) timeline.push({ at: a.createdAt, kind: "alert", text: `Alert ${a.id} raised: ${(a.aiLevel ?? a.baselineLevel).toLowerCase()} risk, score ${a.baselineScore}`, risk: a.aiLevel ?? a.baselineLevel, ref: a.id });
    if (d) timeline.push({ at: d.decidedAt, kind: "decision", text: `${d.decidedBy} decided ${d.action.replaceAll("_", " ").toLowerCase()} → ${d.label === "FRAUD" ? "fraud" : "not fraud"}`, risk: d.label === "FRAUD" ? "HIGH" : "LOW", ref: a!.id });
  }
  for (const e of s.watchlist) if (e.type === "ACCOUNT" && e.value.toUpperCase() === accountId.toUpperCase()) timeline.push({ at: e.createdAt, kind: "watchlist", text: `${e.list === "BLACK" ? "Blacklisted" : "Whitelisted"} by ${e.createdBy}: ${e.reason || "no reason"}`, risk: e.list === "BLACK" ? "HIGH" : "LOW" });
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  const all = txs.map(tx), alerts = all.filter((t) => t.alertId);
  const order: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return {
    accountId, name: ben?.name ?? null, bank: ben?.bankName ?? null,
    summary: {
      received: all.reduce((n, t) => n + t.amount, 0), transfers: all.length, senders: bySender.size, alerts: alerts.length,
      fraud: all.filter((t) => t.outcome === "FRAUD").length, firstSeen: all[0]?.at ?? null, lastSeen: all.at(-1)?.at ?? null,
      maxRisk: alerts.reduce<string | null>((m, t) => (!m || order[t.risk!] > order[m] ? t.risk! : m), null),
      linkedAccounts: net.linkedAccountsCount, sharedDevice: net.sharedDeviceWith,
    },
    blocked: [...nodes.values()].filter((n) => n.blocked).map((n) => ({ kind: n.kind, label: n.label })),
    nodes: [...nodes.values()], edges, timeline,
  };
}
export type AccountGraph = ReturnType<typeof accountGraph>;

// All beneficiary accounts that have a graph (transfers and/or network links), riskiest first. Feeds the Graph Explorer list.
export function accountIndex(s: State) {
  const now = Date.now(), order: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  const blocked = (v: string) => s.watchlist.some((e) => e.list === "BLACK" && e.type === "ACCOUNT" && (!e.expiresAt || Date.parse(e.expiresAt) > now) && e.value.toUpperCase() === v.toUpperCase());
  const alertOf = new Map(s.alerts.map((a) => [a.transactionId, a])), fraudOf = new Set(s.decisions.filter((d) => d.label === "FRAUD").map((d) => d.alertId));
  const m = new Map<string, { accountId: string; name: string; bank: string; transfers: number; received: number; senders: Set<string>; alerts: number; fraud: number; maxRisk: string | null; lastSeen: string; accountAgeDays: number }>();
  for (const t of s.transactions) {
    const b = t.beneficiary, o = m.get(b.accountId) ?? { accountId: b.accountId, name: b.name, bank: b.bankName, transfers: 0, received: 0, senders: new Set<string>(), alerts: 0, fraud: 0, maxRisk: null, lastSeen: t.createdAt, accountAgeDays: b.accountAgeDays };
    o.transfers++; o.received += t.amount; o.senders.add(t.customerId); if (t.createdAt > o.lastSeen) o.lastSeen = t.createdAt;
    const a = alertOf.get(t.id);
    if (a) { o.alerts++; if (fraudOf.has(a.id)) o.fraud++; const l = a.aiLevel ?? a.baselineLevel; if (!o.maxRisk || order[l] > order[o.maxRisk]) o.maxRisk = l; }
    m.set(b.accountId, o);
  }
  return [...m.values()].map(({ senders, ...o }) => {
    const net = s.network[o.accountId];
    const linked = net?.linkedAccountsCount ?? 0, shared = net?.sharedDeviceWith ?? 0, isBlocked = blocked(o.accountId);
    // Ranking: confirmed fraud, blocklist, network links, alerts, risk.
    const rank = o.fraud * 100 + (isBlocked ? 80 : 0) + linked * 3 + shared * 10 + o.alerts * 5 + (o.maxRisk ? order[o.maxRisk] * 10 : 0) + (o.accountAgeDays < 30 ? 10 : 0);
    return { ...o, senders: senders.size, linkedAccounts: linked, sharedDevice: shared, blocked: isBlocked, rank };
  }).filter((o) => o.senders > 1 || o.alerts > 0 || o.linkedAccounts > 0 || o.blocked) // single routine payee with nothing else has no graph worth exploring
    .sort((a, b) => b.rank - a.rank || b.received - a.received);
}
