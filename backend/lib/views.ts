import type { State } from "./store";
import type { Alert, Customer, Session, Transaction } from "./types";
import { amlScreen } from "./intel.ts";
import { matches } from "./rules/dsl.ts";
import { featuresOf } from "./rules/backtest.ts";

// Read models for the investigation tools: Investigator search, Customer Profiles, Device Intelligence, Session view, Feedback.
const RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const sev = (a: Alert) => a.aiLevel ?? a.baselineLevel;
const maxLevel = (ls: string[]) => ls.reduce<string | null>((m, l) => (!m || RANK[l] > RANK[m] ? l : m), null);
const live = (s: State, type: string, v: string) => s.watchlist.some((e) => e.list === "BLACK" && e.type === type && (!e.expiresAt || Date.parse(e.expiresAt) > Date.now()) && e.value.trim().toUpperCase() === v.trim().toUpperCase());
const decisionOf = (s: State, alertId: string) => s.decisions.find((d) => d.alertId === alertId);

// ---- Investigator: one search box across everything ----
export function search(s: State, raw: string) {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return { query: raw, total: 0, groups: [] as { kind: string; items: { id: string; title: string; sub: string; href: string; risk?: string }[] }[] };
  const hit = (...v: (string | undefined | null)[]) => v.some((x) => x?.toLowerCase().includes(q));
  const take = <T,>(xs: T[]) => xs.slice(0, 8);
  const customers = take(s.customers.filter((c) => hit(c.id, c.name, c.accountId, c.maskedAccount, c.phone, c.city))).map((c) => ({ id: c.id, title: c.name, sub: `${c.id} · ${c.accountId} · ${c.city}`, href: `/customers/${c.id}`, risk: c.riskProfile }));
  const accts = new Map<string, Transaction["beneficiary"]>();
  for (const t of s.transactions) if (hit(t.beneficiary.accountId, t.beneficiary.name)) accts.set(t.beneficiary.accountId, t.beneficiary);
  const accounts = take([...accts.values()]).map((b) => ({ id: b.accountId, title: b.name, sub: `${b.accountId} · ${b.bankName}${live(s, "ACCOUNT", b.accountId) ? " · blocklisted" : ""}`, href: `/graph?account=${encodeURIComponent(b.accountId)}`, risk: live(s, "ACCOUNT", b.accountId) ? "HIGH" : undefined }));
  const devs = new Set<string>();
  for (const x of s.sessions) if (hit(x.deviceModel)) devs.add(x.deviceModel);
  const devices = take([...devs]).map((d) => ({ id: d, title: d, sub: `${s.sessions.filter((x) => x.deviceModel === d).length} sessions`, href: `/devices/${encodeURIComponent(d)}`, risk: live(s, "DEVICE", d) ? "HIGH" : undefined }));
  const alerts = take(s.alerts.filter((a) => hit(a.id, a.transactionId, a.customerId, s.customers.find((c) => c.id === a.customerId)?.name))).map((a) => ({ id: a.id, title: `${a.id} · ${s.customers.find((c) => c.id === a.customerId)?.name ?? ""}`, sub: `${a.status} · score ${a.baselineScore}`, href: `/alerts/${a.id}`, risk: sev(a) }));
  const cases = take(s.cases.filter((c) => hit(c.id, c.title))).map((c) => ({ id: c.id, title: `${c.id} · ${c.title}`, sub: `${c.status} · ${c.alertIds.length} alerts`, href: `/cases/${c.id}`, risk: c.priority }));
  type Item = { id: string; title: string; sub: string; href: string; risk?: string };
  const sessions: Item[] = take(s.sessions.filter((x) => hit(x.id))).map((x) => ({ id: x.id, title: x.id, sub: `${x.deviceModel} · ${x.ipCountry}`, href: `/sessions/${x.id}` }));
  const txs: Item[] = take(s.transactions.filter((t) => hit(t.id))).map((t) => ({ id: t.id, title: t.id, sub: `Rp ${t.amount.toLocaleString("id-ID")} → ${t.beneficiary.name} · ${t.status}`, href: s.alerts.find((a) => a.transactionId === t.id) ? `/alerts/${s.alerts.find((a) => a.transactionId === t.id)!.id}` : `/customers/${t.customerId}` }));
  const ips = take([...new Set([...s.events.map((e) => e.ip), ...s.watchlist.filter((w) => w.type === "IP").map((w) => w.value)].filter((x): x is string => !!x && hit(x)))]).map((ip) => ({ id: ip, title: ip, sub: live(s, "IP", ip) ? "blocklisted" : "seen in login events", href: `/intel?tab=events`, risk: live(s, "IP", ip) ? "HIGH" : undefined }));
  const groups: { kind: string; items: Item[] }[] = [{ kind: "Customers", items: customers }, { kind: "Beneficiary accounts", items: accounts }, { kind: "Alerts", items: alerts }, { kind: "Cases", items: cases }, { kind: "Devices", items: devices }, { kind: "Sessions", items: sessions }, { kind: "Transactions", items: txs }, { kind: "IP addresses", items: ips }].filter((g) => g.items.length);
  return { query: raw, total: groups.reduce((n, g) => n + g.items.length, 0), groups };
}

// ---- Customer Profiles ----
export function customerList(s: State) {
  return s.customers.map((c) => {
    const as = s.alerts.filter((a) => a.customerId === c.id), txs = s.transactions.filter((t) => t.customerId === c.id);
    return { id: c.id, name: c.name, accountId: c.accountId, maskedAccount: c.maskedAccount, segment: c.segment, city: c.city, accountStatus: c.accountStatus, riskProfile: c.riskProfile,
      maxRisk: maxLevel(as.map(sev)), alerts: as.length, openAlerts: as.filter((a) => a.status !== "Decided").length, fraud: as.filter((a) => decisionOf(s, a.id)?.label === "FRAUD").length,
      transactions: txs.length, lastActivity: txs.reduce<string | null>((m, t) => (!m || t.createdAt > m ? t.createdAt : m), null), blocked: live(s, "ACCOUNT", c.accountId) };
  });
}

export function customerProfile(s: State, id: string) {
  const c = s.customers.find((x) => x.id === id);
  if (!c) return null;
  const txs = s.transactions.filter((t) => t.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const as = s.alerts.filter((a) => a.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sessions = s.sessions.filter((x) => x.customerId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const bens = new Map<string, { accountId: string; name: string; bank: string; amount: number; count: number; last: string; known: boolean; blocked: boolean }>();
  for (const t of txs) { const b = t.beneficiary, o = bens.get(b.accountId) ?? { accountId: b.accountId, name: b.name, bank: b.bankName, amount: 0, count: 0, last: t.createdAt, known: c.knownBeneficiaries.includes(b.accountId), blocked: live(s, "ACCOUNT", b.accountId) }; o.amount += t.amount; o.count++; bens.set(b.accountId, o); }
  const devices = [...new Set([c.usualDevice, ...sessions.map((x) => x.deviceModel)])].map((d) => ({ device: d, usual: d === c.usualDevice, sessions: sessions.filter((x) => x.deviceModel === d).length, blocked: live(s, "DEVICE", d), rooted: sessions.some((x) => x.deviceModel === d && x.deviceRooted) }));
  const scores = as.map((a) => a.baselineScore);
  const weighted = scores.length ? Math.round(scores.reduce((n, x, i) => n + x * (scores.length - i), 0) / scores.reduce((n, _, i) => n + scores.length - i, 0)) : 0; // recent alerts weigh more
  const aml = amlScreen(s, { customerName: c.name, customerId: c.id });
  const timeline: { at: string; kind: string; text: string; ref: string; risk?: string }[] = [
    ...txs.slice(0, 60).map((t) => ({ at: t.createdAt, kind: "transfer", text: `Sent Rp ${t.amount.toLocaleString("id-ID")} to ${t.beneficiary.name} (${t.status.toLowerCase()})`, ref: t.id })),
    ...as.map((a) => ({ at: a.createdAt, kind: "alert", text: `Alert ${a.id}: ${sev(a).toLowerCase()} risk`, ref: a.id, risk: sev(a) })),
    ...s.decisions.filter((d) => as.some((a) => a.id === d.alertId)).map((d) => ({ at: d.decidedAt, kind: "decision", text: `${d.decidedBy}: ${d.action.replaceAll("_", " ").toLowerCase()} → ${d.label === "FRAUD" ? "fraud" : "not fraud"}`, ref: d.alertId, risk: d.label === "FRAUD" ? "HIGH" : "LOW" })),
    ...s.events.filter((e) => e.customerId === id).map((e) => ({ at: e.at, kind: "event", text: `${e.type === "login_attempt" ? "Login" : `Account change (${e.change})`}: ${e.decision}`, ref: e.id, risk: e.decision === "DENY" ? "HIGH" : e.decision === "CHALLENGE" ? "MEDIUM" : "LOW" })),
    ...sessions.map((x) => ({ at: x.startedAt, kind: "session", text: `Session on ${x.deviceModel} from ${x.ipCountry}${x.screenSharingAppDetected ? ` · ${x.screenSharingAppDetected} active` : ""}`, ref: x.id })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
  return {
    customer: c, maxRisk: maxLevel(as.map(sev)) ?? c.riskProfile, weightedScore: weighted, blocked: live(s, "ACCOUNT", c.accountId), aml,
    stats: { transactions: txs.length, total: txs.reduce((n, t) => n + t.amount, 0), avg: txs.length ? Math.round(txs.reduce((n, t) => n + t.amount, 0) / txs.length) : 0, alerts: as.length, open: as.filter((a) => a.status !== "Decided").length, fraud: as.filter((a) => decisionOf(s, a.id)?.label === "FRAUD").length, cases: s.cases.filter((k) => k.alertIds.some((x) => as.some((a) => a.id === x))).length },
    transactions: txs.slice(0, 100).map((t) => ({ ...t, alertId: s.alerts.find((a) => a.transactionId === t.id)?.id })),
    alerts: as.map((a) => ({ id: a.id, createdAt: a.createdAt, level: sev(a), score: a.baselineScore, status: a.status, caseId: a.caseId, outcome: decisionOf(s, a.id)?.label ?? null, amount: s.transactions.find((t) => t.id === a.transactionId)?.amount ?? 0 })),
    cases: s.cases.filter((k) => k.alertIds.some((x) => as.some((a) => a.id === x))).map((k) => ({ id: k.id, title: k.title, status: k.status, priority: k.priority })),
    sessions: sessions.map((x) => ({ id: x.id, startedAt: x.startedAt, device: x.deviceModel, ipCountry: x.ipCountry, vpn: x.isVpnDetected, screenSharing: x.screenSharingAppDetected, newDevice: x.isNewDevice })),
    beneficiaries: [...bens.values()].sort((a, b) => b.amount - a.amount).slice(0, 30), devices, timeline,
    events: s.events.filter((e) => e.customerId === id).slice(0, 50),
  };
}

// ---- Device Intelligence ----
function deviceRisk(xs: Session[], alerts: Alert[], blocked: boolean) {
  let r = 0;
  if (blocked) r += 60;
  if (xs.some((x) => x.deviceRooted)) r += 25;
  if (xs.some((x) => x.screenSharingAppDetected)) r += 25;
  if (new Set(xs.map((x) => x.customerId)).size > 1) r += 20;
  if (xs.some((x) => x.isVpnDetected)) r += 10;
  r += Math.min(20, alerts.filter((a) => RANK[sev(a)] >= 2).length * 10);
  return Math.min(100, r);
}
export function devices(s: State) {
  const by = new Map<string, Session[]>();
  for (const x of s.sessions) by.set(x.deviceModel, [...(by.get(x.deviceModel) ?? []), x]);
  return [...by].map(([d, xs]) => {
    const ids = new Set(xs.map((x) => x.id)), alerts = s.alerts.filter((a) => ids.has(s.transactions.find((t) => t.id === a.transactionId)?.sessionId ?? ""));
    const blocked = live(s, "DEVICE", d);
    return { device: d, sessions: xs.length, customers: new Set(xs.map((x) => x.customerId)).size, rooted: xs.some((x) => x.deviceRooted), screenSharing: xs.some((x) => x.screenSharingAppDetected), vpn: xs.some((x) => x.isVpnDetected),
      countries: [...new Set(xs.map((x) => x.ipCountry))], alerts: alerts.length, fraud: alerts.filter((a) => decisionOf(s, a.id)?.label === "FRAUD").length, lastSeen: xs.reduce((m, x) => (x.startedAt > m ? x.startedAt : m), ""), blocked, risk: deviceRisk(xs, alerts, blocked) };
  }).sort((a, b) => b.risk - a.risk || b.sessions - a.sessions);
}
export function deviceDetail(s: State, device: string) {
  const row = devices(s).find((d) => d.device === device);
  if (!row) return null;
  const xs = s.sessions.filter((x) => x.deviceModel === device).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { ...row, customersList: [...new Set(xs.map((x) => x.customerId))].map((id) => { const c = s.customers.find((x) => x.id === id)!; return { id, name: c.name, usual: c.usualDevice === device }; }),
    sessionsList: xs.map((x) => ({ id: x.id, startedAt: x.startedAt, customerId: x.customerId, ipCountry: x.ipCountry, vpn: x.isVpnDetected, rooted: x.deviceRooted, screenSharing: x.screenSharingAppDetected, newDevice: x.isNewDevice })) };
}

// ---- Session view (sections like a device-intelligence console) ----
export function sessionDetail(s: State, id: string) {
  const x = s.sessions.find((y) => y.id === id);
  if (!x) return null;
  const c: Customer = s.customers.find((y) => y.id === x.customerId)!, txs = s.transactions.filter((t) => t.sessionId === id);
  const alerts = s.alerts.filter((a) => txs.some((t) => t.id === a.transactionId));
  const fired = s.rules.flatMap((r) => txs.filter((t) => matches(r.condition, featuresOf(s, t))).map((t) => ({ ruleId: r.id, name: r.name, status: r.status, action: r.action, severity: r.severity, expression: r.expression, transactionId: t.id })));
  const reasons = Object.values(s.investigations).filter((i) => alerts.some((a) => a.id === i.alertId) && i.report).flatMap((i) => i.report!.reasonCodes.map((rc) => ({ ...rc, alertId: i.alertId })));
  const base = c.sessionBaseline, dev = (v: number, b: number) => (b ? Math.round(((v - b) / b) * 100) : 0);
  const biometrics = [
    { signal: "Hesitation time", value: `${(x.hesitationTimeMs / 1000).toFixed(1)} s`, baseline: `${(base.hesitationTimeMs / 1000).toFixed(1)} s`, deviation: dev(x.hesitationTimeMs, base.hesitationTimeMs), risky: x.hesitationTimeMs > base.hesitationTimeMs * 2 },
    { signal: "Typing cadence deviation", value: x.typingCadenceDeviation.toFixed(2), baseline: base.typingCadenceDeviation.toFixed(2), deviation: dev(x.typingCadenceDeviation, base.typingCadenceDeviation), risky: x.typingCadenceDeviation > base.typingCadenceDeviation * 2 },
    { signal: "Session duration", value: `${x.sessionDurationSec} s`, baseline: `${base.sessionDurationSec} s`, deviation: dev(x.sessionDurationSec, base.sessionDurationSec), risky: x.sessionDurationSec > base.sessionDurationSec * 2 },
    { signal: "Copy-paste on beneficiary field", value: String(x.copyPasteEventsOnBeneficiaryField), baseline: "0", deviation: null, risky: x.copyPasteEventsOnBeneficiaryField > 0 },
    { signal: "Navigation pattern", value: x.navigationPattern, baseline: base.navigationPattern, deviation: null, risky: x.navigationPattern !== base.navigationPattern },
    { signal: "Failed PIN attempts", value: String(x.failedPinAttempts), baseline: "0", deviation: null, risky: x.failedPinAttempts > 0 },
  ];
  const deviceSignals = [
    { signal: "Device", value: x.deviceModel, risky: x.deviceModel !== c.usualDevice, note: x.deviceModel === c.usualDevice ? "usual device" : `usual: ${c.usualDevice}` },
    { signal: "New device", value: x.isNewDevice ? "yes" : "no", risky: x.isNewDevice },
    { signal: "Rooted / jailbroken", value: x.deviceRooted ? "yes" : "no", risky: x.deviceRooted },
    { signal: "Screen-sharing / remote app", value: x.screenSharingAppDetected ?? "none", risky: !!x.screenSharingAppDetected },
    { signal: "Device blocklisted", value: live(s, "DEVICE", x.deviceModel) ? "yes" : "no", risky: live(s, "DEVICE", x.deviceModel) },
  ];
  const location = [
    { signal: "IP country", value: x.ipCountry, risky: x.ipCountry !== c.homeCountry, note: `home ${c.homeCountry}` },
    { signal: "VPN / proxy", value: x.isVpnDetected ? "detected" : "no", risky: x.isVpnDetected },
    { signal: "Customer city", value: c.city, risky: false },
  ];
  const sanctions = [amlScreen(s, { customerName: c.name, customerId: c.id, ipCountry: x.ipCountry }), ...txs.map((t) => amlScreen(s, { beneficiaryName: t.beneficiary.name }))];
  const flags = [...biometrics, ...deviceSignals, ...location].filter((b) => b.risky).length;
  const risk = maxLevel(alerts.map(sev)) ?? (flags >= 4 ? "HIGH" : flags ? "MEDIUM" : "LOW"); // sessions without an alert: from their own signals
  return {
    session: x, customer: { id: c.id, name: c.name, maskedAccount: c.maskedAccount, segment: c.segment, city: c.city, usualDevice: c.usualDevice, riskProfile: c.riskProfile },
    risk, flow: txs.length ? "transfer" : "login", channel: txs[0]?.channel ?? "MOBILE_APP",
    transactions: txs.map((t) => ({ id: t.id, amount: t.amount, beneficiary: t.beneficiary.name, status: t.status, createdAt: t.createdAt })),
    alerts: alerts.map((a) => ({ id: a.id, level: sev(a), score: a.baselineScore, status: a.status, outcome: decisionOf(s, a.id)?.label ?? null })),
    firedRules: fired, reasonCodes: reasons, sanctions: { hit: sanctions.some((r) => r.hit), matches: sanctions.flatMap((r) => r.matches), reasons: [...new Set(sanctions.flatMap((r) => r.reasons))] },
    location, device: deviceSignals, biometrics,
    feedback: alerts.map((a) => decisionOf(s, a.id)).filter((d) => !!d).map((d) => ({ alertId: d.alertId, label: d.label, action: d.action, by: d.decidedBy, at: d.decidedAt, reason: d.reason, followedAi: d.followedAi })),
  };
}

// ---- Feedback: analyst labels as training / tuning signal ----
export function feedback(s: State) {
  const rows = s.decisions.map((d) => {
    const a = s.alerts.find((x) => x.id === d.alertId), c = a && s.customers.find((x) => x.id === a.customerId);
    return { alertId: d.alertId, customer: c?.name ?? "", label: d.label, action: d.action, by: d.decidedBy, at: d.decidedAt, reason: d.reason, followedAi: d.followedAi, aiRecommendation: s.recommendations[d.alertId] ?? null, baselineLevel: a?.baselineLevel ?? null, aiLevel: a?.aiLevel ?? null, amount: d.amount };
  }).sort((a, b) => b.at.localeCompare(a.at));
  const n = rows.length;
  return {
    rows,
    summary: { total: n, fraud: rows.filter((r) => r.label === "FRAUD").length, notFraud: rows.filter((r) => r.label === "NOT_FRAUD").length,
      aiAgreement: rows.filter((r) => r.aiRecommendation).length ? rows.filter((r) => r.aiRecommendation && r.followedAi).length / rows.filter((r) => r.aiRecommendation).length : null,
      baselineFalsePositive: rows.filter((r) => r.baselineLevel === "HIGH").length ? rows.filter((r) => r.baselineLevel === "HIGH" && r.label === "NOT_FRAUD").length / rows.filter((r) => r.baselineLevel === "HIGH").length : null,
      customerConfirmed: rows.filter((r) => r.by.startsWith("customer:")).length, autoResolved: rows.filter((r) => r.by.startsWith("system:")).length },
  };
}
