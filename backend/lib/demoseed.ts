import type { State } from "./store";
import type { Decision } from "./types";
import { createCase, saveAttachment, slaDue, type Case } from "./cases.ts";
import { scoreEvent, type ListEntry, type RiskEvent } from "./intel.ts";

// Demo content for Cases and Risk Intelligence, built from the seeded alerts so every link works. Runs once per state.
const H = 3600e3;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();

export function seedDemo(s: State & { demoSeeded?: boolean }) {
  if (s.demoSeeded) return;
  s.demoSeeded = true;
  const open = s.alerts.filter((a) => a.status !== "Decided" && !a.caseId);
  const byCustomer = new Map<string, typeof open>();
  for (const a of open) byCustomer.set(a.customerId, [...(byCustomer.get(a.customerId) ?? []), a]);
  const groups = [...byCustomer.values()].sort((x, y) => y.length - x.length);
  const users = ["sari", "supervisor", "admin"];
  const plans: { title: string; status: Case["status"]; priority?: Case["priority"]; age: number; notes: string[]; resolution?: string; file?: [string, string] }[] = [
    { title: "Suspected mule network: repeated transfers to new beneficiaries", status: "ESCALATED", priority: "HIGH", age: 9, notes: ["Three beneficiaries share one device (network graph).", "Escalated to supervisor; awaiting confirmation from the receiving bank."], file: ["receiving-bank-request.txt", "Request to Bank Nusantara Digital for beneficiary KYC, sent 09:40 WIB."] },
    { title: "Possible account takeover: login from new device, then large transfer", status: "IN_PROGRESS", priority: "HIGH", age: 2, notes: ["Customer unreachable by phone at 10:15; SMS sent.", "Device fingerprint differs from usual device."] },
    { title: "Unusual evening transfers above daily spend", status: "OPEN", priority: "MEDIUM", age: 1, notes: ["Amounts 8–12× the customer's average. Checking with branch."] },
    { title: "Social engineering report from customer call centre", status: "OPEN", priority: "CRITICAL", age: 0.5, notes: ["Customer called 14041: says 'bank officer' asked to install a screen-sharing app."], file: ["call-centre-ticket.txt", "Ticket CC-88213: caller reports impersonation, screen-sharing app installed on request."] },
    { title: "Low-value test transfers before a large one", status: "IN_PROGRESS", priority: "MEDIUM", age: 20, notes: ["Pattern: Rp 10k, Rp 25k, then Rp 9.5 juta to the same new beneficiary."] },
    { title: "Customer confirmed genuine purchase (property down payment)", status: "CLOSED", priority: "LOW", age: 30, notes: ["Customer showed the sale agreement at the branch."], resolution: "Genuine transfer; customer verified in person. Beneficiary added to the whitelist for 90 days." },
  ];
  plans.forEach((p, i) => {
    const alerts = groups[i]?.slice(0, i === 0 ? 3 : 2);
    if (!alerts?.length) return;
    const c = createCase(s, { title: p.title, alertIds: alerts.map((a) => a.id), priority: p.priority, assignee: users[i % users.length] }, users[(i + 1) % users.length]);
    if (typeof c === "string") return;
    const created = ago(p.age);
    Object.assign(c, { createdAt: created, updatedAt: ago(Math.max(0, p.age - 0.3)), slaDueAt: slaDue(c.priority, new Date(created)), status: p.status });
    c.events[0].at = created;
    if (p.status === "IN_PROGRESS") c.events.push({ at: ago(p.age - 0.2), by: c.assignee, text: "Status OPEN → IN_PROGRESS" });
    if (p.status === "ESCALATED") { c.escalated = true; c.events.push({ at: ago(p.age - 4), by: "system:sla", text: "Escalated: 4 h SLA breached" }); }
    if (p.status === "CLOSED") { c.resolution = p.resolution; c.closedAt = ago(p.age - 2); c.events.push({ at: c.closedAt, by: c.assignee, text: `Status IN_PROGRESS → CLOSED: ${p.resolution}` }); }
    p.notes.forEach((t, j) => s.notes.push({ id: `NOTE-demo${i}${j}`, entity: `case:${c.id}`, by: j % 2 ? "supervisor" : c.assignee, at: ago(p.age - 0.1 - j * 0.3), text: t }));
    s.notes.push({ id: `NOTE-demoA${i}`, entity: `alert:${alerts[0].id}`, by: c.assignee, at: ago(p.age - 0.05), text: `Linked to ${c.id}. ${p.notes[0]}` });
    if (p.file) saveAttachment(s, `case:${c.id}`, p.file[0], "text/plain", Buffer.from(p.file[1]), c.assignee);
    for (const a of alerts) a.assignedTo ||= c.assignee;
  });

  // A few watchlist entries tied to the demo story.
  const ben = s.transactions.find((t) => t.id === groups[0]?.[0]?.transactionId)?.beneficiary;
  const list = (e: Omit<ListEntry, "id" | "createdAt" | "hits"> & { age: number }): ListEntry => ({ ...e, id: `WL-${String(s.nextIntelSeq++).padStart(5, "0")}`, createdAt: ago(e.age), hits: 0 });
  s.watchlist.push(
    ...(ben ? [list({ list: "BLACK", type: "ACCOUNT", value: ben.accountId, reason: "Mule account, see the escalated mule-network case", expiresAt: null, createdBy: "supervisor", age: 8 })] : []),
    list({ list: "BLACK", type: "DEVICE", value: "Xiaomi Redmi Note 8 (rooted)", reason: "Device used in 4 takeover attempts", expiresAt: null, createdBy: "sari", age: 48 }),
    list({ list: "BLACK", type: "IP", value: "185.220.101.0/24", reason: "Tor exit range seen in phishing logins", expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), createdBy: "admin", age: 72 }),
    list({ list: "WHITE", type: "BENEFICIARY", value: "PT Properti Sejahtera Abadi", reason: "Verified developer (closed case)", expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(), createdBy: "sari", age: 28 }),
    list({ list: "WHITE", type: "ACCOUNT", value: "ACC-PLN-0001", reason: "Utility biller", expiresAt: null, createdBy: "admin", age: 400 }),
  );

  // Login / account-update events.
  const cs = s.customers.slice(0, 6);
  const ev: [number, Omit<RiskEvent, "id" | "at" | "score" | "decision" | "reasons" | "hits">][] = [
    [0.2, { type: "login_attempt", customerId: cs[0].id, sessionId: null, deviceId: "iPhone 15 Pro", ip: "185.220.101.44", ipCountry: "RU", success: false, failedAttempts: 3, change: null }],
    [0.3, { type: "account_update", customerId: cs[0].id, sessionId: null, deviceId: "iPhone 15 Pro", ip: "185.220.101.44", ipCountry: "RU", success: null, failedAttempts: 0, change: "phone" }],
    [1, { type: "login_attempt", customerId: cs[1].id, sessionId: null, deviceId: cs[1].usualDevice, ip: "36.84.12.9", ipCountry: "ID", success: true, failedAttempts: 0, change: null }],
    [2, { type: "login_attempt", customerId: cs[2].id, sessionId: null, deviceId: "Samsung A54", ip: "103.47.8.2", ipCountry: "ID", success: true, failedAttempts: 1, change: null }],
    [3, { type: "account_update", customerId: cs[3].id, sessionId: null, deviceId: cs[3].usualDevice, ip: "114.4.2.7", ipCountry: "ID", success: null, failedAttempts: 0, change: "address" }],
    [5, { type: "login_attempt", customerId: cs[4].id, sessionId: null, deviceId: "Xiaomi Redmi Note 8 (rooted)", ip: "182.1.3.4", ipCountry: "ID", success: true, failedAttempts: 0, change: null }],
    [7, { type: "account_update", customerId: cs[5].id, sessionId: null, deviceId: "Pixel 8", ip: "110.137.2.1", ipCountry: "SG", success: null, failedAttempts: 0, change: "password" }],
  ];
  for (const [h, e] of ev.reverse()) s.events.unshift({ id: `EVT-${String(s.nextIntelSeq++).padStart(6, "0")}`, at: ago(h), ...e, ...scoreEvent(s, e) });
}

// Seeded analyst decisions. The Command Center's "Fraud detected" and "False positive rate" are derived from
// state.decisions, but the seed had none, so both read 0 / empty on a fresh demo. This back-fills a realistic,
// deterministic history.
//
// The outcome leans on the alert's risk score (a flagged transfer that scores HIGH is usually real fraud, a
// borderline one usually clears), which keeps the false-positive rate believable instead of "everything is a
// false alarm". It is tuned so the demo shows a strong detector: roughly 1 in 4 cleared alerts is a false
// positive. The HIGH alerts are deliberately left open so "open high-risk" still shows work in progress.
export function seedDecisions(s: State & { decisionsSeeded?: boolean }) {
  if (s.decisionsSeeded) return;
  s.decisionsSeeded = true;
  const closedCases = new Set(s.cases.filter((c) => c.status === "CLOSED").map((c) => c.id));
  const users = ["sari", "supervisor", "admin"];
  const txById = new Map(s.transactions.map((t) => [t.id, t]));
  // Deterministic pseudo-random in [0,1) from the alert number, so the same demo always looks the same.
  const rnd = (n: number) => ((Math.imul(n, 2654435761) >>> 0) % 1000) / 1000;
  let n = 0;
  for (const a of [...s.alerts].sort((x, y) => x.id.localeCompare(y.id))) {
    const num = Number(a.id.slice(4));
    if (!Number.isFinite(num)) continue;
    if ((a.aiLevel ?? a.baselineLevel) === "HIGH") continue;           // keep severe alerts open for the demo
    if (a.caseId && !closedCases.has(a.caseId)) continue;             // a live case still owns its alerts
    if (num % 5 === 0) continue;                                      // ~20% still awaiting a decision
    const score = a.baselineScore;
    // Chance the alert is confirmed fraud: rises with the risk score.
    const pFraud = score >= 60 ? 0.9 : score >= 30 ? 0.8 : 0.5;
    const label: Decision["label"] = rnd(num) < pFraud ? "FRAUD" : "NOT_FRAUD";
    const action: Decision["action"] = label === "FRAUD" ? "DECLINE" : "APPROVE";
    const tx = txById.get(a.transactionId);
    const decidedAt = new Date(Math.min(Date.parse(a.createdAt) + 40 * 60e3, Date.now())).toISOString();
    s.decisions.push({
      alertId: a.id, action, label, followedAi: rnd(num + 7) > 0.2,
      reason: label === "FRAUD" ? "Confirmed fraud after analyst review." : "Legitimate activity confirmed with the customer.",
      decidedBy: users[n++ % users.length], decidedAt, amount: tx?.amount ?? 0,
    });
    a.status = "Decided";
    if (tx) tx.status = action === "APPROVE" ? "RELEASED" : "DECLINED";
  }
}
