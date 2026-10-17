import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateRule, type Rule } from "./rules/dsl.ts";
import { DEFAULT_NAME, migrate, SEED_WORKFLOWS, type Workflow } from "./workflows.ts";
import { seedDecisions, seedDemo } from "./demoseed.ts";
import type { Schedule } from "./schedules.ts";
import type { AmlEntry, ListEntry, RiskEvent } from "./intel.ts";
import type { Attachment, Case, Note } from "./cases.ts";
import type { Challenge, CustomerMessage } from "./custchannel.ts";
import type { Alert, AuditEvent, Decision, Investigation, Seed, Session, Transaction } from "./types";

const DIR = join(/*turbopackIgnore: true*/ process.cwd(), "data", "seed");
const json = <T>(p: string): T => JSON.parse(readFileSync(join(DIR, p), "utf8"));

function parseKb(file: string) {
  const raw = readFileSync(join(DIR, "kb", file), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`kb/${file}: missing front matter`);
  const fm = Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  return { docId: fm.docId, title: fm.title, tags: fm.tags.split(",").map((t) => t.trim()), body: m[2].trim() };
}

// Seed timestamps are relative to meta.anchor; shift them so "30 days of history" is always relative to now.
// Simulated daily rhythm: quiet morning, busy midday, busiest evening. Weights by WIB hour.
const HOURLY = [3, 2, 1, 1, 1, 1, 2, 2, 3, 4, 6, 8, 10, 10, 9, 7, 6, 6, 8, 10, 12, 12, 9, 5];
const HR = 3600e3;
const NOISE_ID = 140; // ALT-0001..ALT-0140 are the synthetic "quiet day" alerts; refresh() re-spreads exactly these
// Hour segments [from, to) between two instants, each weighted by its WIB hour of day.
function segments(from: number, to: number) {
  const out: { from: number; to: number; w: number }[] = [];
  for (let t = from; t < to; ) {
    const end = Math.min(to, Math.floor((t + 7 * HR) / HR) * HR + HR - 7 * HR);
    out.push({ from: t, to: end, w: HOURLY[(new Date(t).getUTCHours() + 7) % 24] * ((end - t) / HR) });
    t = end;
  }
  return out;
}
// n evenly spaced quantiles of the weighted segments, oldest first: deterministic, ordered, daily-shaped.
function spread(n: number, segs: ReturnType<typeof segments>) {
  const total = segs.reduce((x, y) => x + y.w, 0);
  return Array.from({ length: n }, (_, i) => {
    let q = ((i + 0.5) / n) * total, b = 0;
    while (b < segs.length - 1 && q > segs[b].w) q -= segs[b++].w;
    return new Date(segs[b].from + (q / segs[b].w) * (segs[b].to - segs[b].from)).toISOString();
  });
}

// Number of days of synthetic history to keep for alerts / normal traffic.
const DAYS = 30;
// Slot placement is snapped to this grid so hitting refresh twice in quick succession gives byte-identical
// output. 15 min is short enough that the newest alert still reads as "just now" on the dashboard.
const SNAP = 15 * 60e3;
// Start of the current WIB day (UTC+7), the reference point for every daily window below.
const wibDayStart = (t: number) => Math.floor((t + 7 * HR) / (24 * HR)) * 24 * HR - 7 * HR;

// ---- Beneficiary identities (looks like a real bank, not "Beneficiary 0001-1") ----
// The old seed reused one beneficiary account across random banks and named it "Beneficiary 0001-1", which
// looked like raw data in the connections graph. Here each account id maps to exactly one bank and one
// identity, and every name is MASKED the way a bank sees a counterparty at another bank
// (e.g. "Rizky Sa****" for a person, "PT Maju Jaya****" for a business).
const BEN_BANKS = ["Bank Nusantara Digital", "Bank Samudra", "Bank Cendana", "Bank Arunika"];
const BEN_FIRST = ["Andi", "Budi", "Citra", "Dewi", "Eko", "Fajar", "Galih", "Hendra", "Intan", "Joko", "Kartika", "Lestari", "Maya", "Nadia", "Putri", "Rina", "Rizky", "Sari", "Taufik", "Wulan"];
const BEN_LAST = ["Pratama", "Santoso", "Wijaya", "Hartono", "Nugroho", "Saputra", "Lubis", "Siregar", "Kusuma", "Pangestu", "Halim", "Rahayu", "Setiawan", "Maharani", "Firmansyah", "Hidayat", "Purnama", "Anggraini"];
const BEN_PREFIX = ["PT", "CV", "UD", "Koperasi", "Toko"];
const BEN_WORD = ["Maju", "Jaya", "Sejahtera", "Abadi", "Sentosa", "Bersama", "Nusantara", "Mandiri", "Cemerlang", "Prima", "Utama", "Digital", "Karya", "Sumber", "Rejeki", "Makmur", "Anugerah", "Bintang"];
// FNV-1a: stable across runs and machines, so the same account always yields the same identity.
const benHash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// Off-US names arrive masked: an individual keeps the given name and two letters of the family name
// ("Rizky Sa****"), a business keeps its trade name ("PT Maju Jaya****").
const maskBeneficiary = (full: string, corp: boolean) => {
  const parts = full.split(" ");
  if (corp) return `${parts.slice(0, Math.min(3, parts.length)).join(" ")}****`;
  return `${parts[0]} ${(parts[parts.length - 1] ?? "").slice(0, 2)}****`;
};
const beneficiaryIdentity = (accountId: string): { bankName: string; name: string } => {
  const h = benHash(accountId);
  const at = (n: number, shift: number) => (h >>> shift) % n; // unsigned shift: a signed one turns a high bit into a negative index
  const bankName = BEN_BANKS[h % BEN_BANKS.length];
  const corp = h % 100 < 30; // roughly a third of beneficiary accounts are businesses
  let full: string;
  if (corp) {
    const w1 = at(BEN_WORD.length, 5);
    const w2 = (w1 + 1 + at(BEN_WORD.length - 1, 9)) % BEN_WORD.length; // never the same word twice ("Karya Karya")
    full = `${BEN_PREFIX[at(BEN_PREFIX.length, 3)]} ${BEN_WORD[w1]} ${BEN_WORD[w2]}`;
  } else {
    full = `${BEN_FIRST[at(BEN_FIRST.length, 3)]} ${BEN_LAST[at(BEN_LAST.length, 5)]}`;
  }
  return { bankName, name: maskBeneficiary(full, corp) }; // always masked, like the counterparty name a bank receives from another bank
};

// Deterministic index -> timestamp mapping over the last `days` days.
// The shape is fixed: how many rows land on each day, which hour of that day, and their order are all derived
// from the index alone, so the same input count always yields the same distribution.
//
// Stability ("same result on every hit"): completed days use ABSOLUTE windows anchored to the WIB day start,
// so they never move while the day is the same. Only the current day (d=0) uses [dayStart, now], because it
// is still filling up; and `now` is snapped to SNAP so repeated hits minutes apart are identical.
//
// Per-day weight: today is heaviest so the default 24h window is well populated, then a believable decay that
// flattens into a steady tail. Within a day the hour follows the shared WIB daily rhythm (HOURLY above).
const DAY_WEIGHT = (d: number, _days: number) => (d === 0 ? 8 : d <= 5 ? 10 / (d + 1) : Math.max(0.55, 1.6 - (d - 5) * 0.04));
function historicalSlots(n: number, nowSnapped: number, days: number): string[] {
  if (!n) return [];
  const dayStart = wibDayStart(nowSnapped);
  const weights = Array.from({ length: days }, (_, d) => DAY_WEIGHT(d, days));
  const wSum = weights.reduce((x, y) => x + y, 0);
  const dayCounts = weights.map((w) => Math.round((n * w) / wSum));
  // Fix rounding so the counts add up to exactly n (adjust the busiest days first).
  let diff = n - dayCounts.reduce((x, y) => x + y, 0);
  for (let i = 0; diff !== 0 && i < days * 2; i++) { const d = i % days; if (diff > 0) { dayCounts[d]++; diff--; } else if (dayCounts[d] > 0) { dayCounts[d]--; diff++; } }
  const out: string[] = [];
  for (let d = 0; d < days; d++) {
    const end = d === 0 ? nowSnapped : dayStart - (d - 1) * 24 * HR; // absolute for d >= 1
    const start = d === 0 ? dayStart : dayStart - d * 24 * HR;
    const slots = spread(dayCounts[d], segments(start, end));
    for (const s of slots) out.push(new Date(Math.min(Date.parse(s), nowSnapped)).toISOString());
  }
  // Oldest first, so index i keeps a stable position in the timeline.
  out.reverse();
  // Safety net: a caller must always get exactly n timestamps (never undefined, which would break toISOString).
  return out.length === n ? out : spread(n, segments(nowSnapped - days * 24 * HR, nowSnapped));
}

// Scenario seed (scripts/gen-scenarios.py): extra customers, sessions, mule network and sanctions entries for the 10 demo scenarios.
type ScenarioSeed = { customers: Seed["customers"]; sessions: (Omit<Session, "startedAt"> & { minutesAgo: number })[]; network: Seed["network"]; aml: Omit<AmlEntry, "createdAt">[] };
const scenarios = (): ScenarioSeed => { try { return json<ScenarioSeed>("scenarios.json"); } catch { return { customers: [], sessions: [], network: {}, aml: [] }; } };
// Scenario sessions are "fresh" (minutes ago) so velocity / recency signals look live.
const scenarioSessions = (sc: ScenarioSeed): Session[] => sc.sessions.map(({ minutesAgo, ...x }) => ({ ...x, startedAt: new Date(Date.now() - minutesAgo * 60e3).toISOString() }));

function loadSeed(): Seed {
  const meta = json<Seed["meta"]>("meta.json");
  const delta = Date.now() - new Date(meta.anchor).getTime();
  const shift = (iso: string) => new Date(new Date(iso).getTime() + delta).toISOString();
  const fallbacks: Record<string, unknown> = {};
  for (const f of readdirSync(join(DIR, "fallbacks"))) fallbacks[f.replace(/\.json$/, "")] = json(`fallbacks/${f}`);
  const now = Date.now(), times = spread(NOISE_ID, segments(now - 24 * HR, now));
  // Today's normal traffic: the share of the 6000-transfer day that has happened so far (WIB midnight .. now).
  const midnight = Math.floor((now + 7 * HR) / (24 * HR)) * 24 * HR - 7 * HR;
  const wDay = HOURLY.reduce((x, y) => x + y, 0), wSoFar = segments(midnight, now).reduce((x, y) => x + y.w, 0);
  const todayTx = json<Transaction[]>("transactions.json").filter((t) => t.id.startsWith("TX-T"));
  const todayAt = spread(Math.round(todayTx.length * wSoFar / wDay), segments(midnight, now));
  const normal = todayTx.slice(0, todayAt.length).map((t, i) => ({ ...t, createdAt: todayAt[i] }));
  const noiseAt = (id: string, re: RegExp) => { const m = id.match(re); return m && Number(m[1]) <= NOISE_ID ? times[Number(m[1]) - 1] : null; };
  return {
    meta,
    customers: [...json<Seed["customers"]>("customers.json").map((c) => ({ ...c, phone: c.phone ?? phoneOf(c.id) })), ...scenarios().customers],
    transactions: [
      ...json<Transaction[]>("transactions.json").filter((t) => !t.id.startsWith("TX-T")).map((t) => ({ ...t, createdAt: noiseAt(t.id, /^TX-A(\d+)$/) ?? shift(t.createdAt) })),
      ...normal,
    ],
    alerts: json<Alert[]>("alerts.json").map((a) => ({ ...a, createdAt: noiseAt(a.id, /^ALT-(\d+)$/) ?? shift(a.createdAt) })),
    sessions: [...json<Session[]>("sessions.json").map((s) => ({ ...s, startedAt: noiseAt(s.id, /^SES-A(\d+)$/) ?? shift(s.startedAt) })), ...scenarioSessions(scenarios())],
    network: { ...json<Seed["network"]>("network.json"), ...scenarios().network },
    reasonCodes: json("reason-codes.json"),
    kb: readdirSync(join(DIR, "kb")).filter((f) => f.endsWith(".md")).sort().map(parseKb),
    fallbacks,
    attackTemplate: json("attack-template.json"),
  };
}

// Collections added after the first release; also back-filled into older saved state.
// Demo phone numbers (deterministic) for customers without one.
const phoneOf = (id: string) => `+62812${String((parseInt(id.replace(/\D/g, ""), 10) * 7919) % 1e8).padStart(8, "0")}`;
const SLA_H = { CRITICAL: 1, HIGH: 4, MEDIUM: 24, LOW: 72 }; // keep in step with SLA_HOURS in cases.ts
const INTEL_DEFAULTS = () => ({
  watchlist: [] as ListEntry[], amlList: [...SEED_AML(), ...scenarios().aml.map((a) => ({ ...a, createdAt: new Date().toISOString() }))], events: [] as RiskEvent[], nextIntelSeq: 100,
  cases: [] as Case[], nextCaseSeq: 1, notes: [] as Note[], attachments: [] as Attachment[], challenges: {} as Record<string, Challenge>, messages: [] as CustomerMessage[],
});
const SEED_AML = (): AmlEntry[] => [
  { id: "AML-001", name: "Rizky Pratama", type: "INTERNAL", country: "ID", source: "Internal mule list", notes: "Beneficiary in 3 confirmed scam cases", createdBy: "system", createdAt: new Date().toISOString() },
  { id: "AML-002", name: "Viktor Petrov Antonov", type: "SANCTION", country: "RU", source: "Demo sanctions list", notes: "Demo entry, not a real person", createdBy: "system", createdAt: new Date().toISOString() },
  { id: "AML-003", name: "H. Bambang Sudarsono", type: "PEP", country: "ID", source: "Demo PEP list", notes: "Demo entry, not a real person", createdBy: "system", createdAt: new Date().toISOString() },
];

export interface State extends Seed {
  fallbackOnly: boolean;
  audit: AuditEvent[];
  decisions: Decision[];
  recommendations: Record<string, string>; // alertId -> Assistant recommendedAction; M3 writes it
  investigations: Record<string, Investigation>;
  rules: Rule[];
  nextRuleSeq: number;
  workflows: Workflow[];
  nextWfSeq: number;
  serving?: unknown; // legacy (pre-role); routes are now bound to the default workflows by `role`
  reportSchedules: Schedule[];
  nextSchedSeq: number;
  watchlist: ListEntry[]; amlList: AmlEntry[]; events: RiskEvent[]; nextIntelSeq: number;
  cases: Case[]; nextCaseSeq: number; notes: Note[]; attachments: Attachment[];
  challenges: Record<string, Challenge>; messages: CustomerMessage[];
  nextAlertSeq: number;
  nextTxSeq: number;
  nextInvSeq: number;
}

const g = globalThis as unknown as { __fortify?: State };

type SeedRule = Pick<Rule, "status" | "createdBy"> & { daysAgo: number };
// Dummy rules for the workflow builder; run through the DSL validator so a bad seed fails loudly at startup.
const seedRules = (): Rule[] => json<SeedRule[]>("rules.json").map((r, i) => {
  const v = validateRule(r);
  if ("error" in v) throw new Error(`rules.json #${i + 1}: ${v.error}`);
  return { ...v.rule, id: `RULE-${String(i + 1).padStart(4, "0")}`, status: r.status, createdBy: r.createdBy, createdAt: new Date(Date.now() - r.daysAgo * 864e5).toISOString() };
});

export function reset(): State {
  const seed = loadSeed();
  const rules = seedRules();
  const nextAlertSeq = Math.max(...seed.alerts.map((a) => Number(a.id.slice(4)))) + 1;
  // fallbackOnly survives reset on purpose: it is a venue-network switch, not demo data.
  g.__fortify = { ...seed, meta: { ...seed.meta, refreshedAt: new Date().toISOString() }, fallbackOnly: g.__fortify?.fallbackOnly ?? false, audit: [], decisions: [], recommendations: {}, investigations: {}, rules, nextRuleSeq: rules.length + 1, workflows: SEED_WORKFLOWS(), nextWfSeq: 6, reportSchedules: [], nextSchedSeq: 1, ...INTEL_DEFAULTS(), nextAlertSeq, nextTxSeq: 1, nextInvSeq: 1 };
  return g.__fortify;
}

// Demo refresh (historically-shaped, deterministic, relationship-preserving).
// Rebuilds the synthetic timeline so the demo always looks alive: the default 24h window is well populated,
// the longer windows (7d / 30d) keep an organic, gently-declining history, and every day holds a realistic
// mix of severities (not "all LOW today, all HIGH a month ago"). Unlike reset() it preserves the analyst's
// work (cases, decisions, investigations, notes, audit) and never overwrites records created at runtime.
//
// Determinism ("same result on every hit"): every generated time is a pure function of (now, group, index)
// with a fixed day/hour weighting, so hits arriving at the same wall-clock millisecond yield byte-identical
// timestamps, and repeated hits never accumulate drift (the earlier slide-forward implementation did).
//
// Relationships kept intact (this is what makes the demo believable rather than merely "non-empty"):
//   * alert <-> transaction: ALT-0007 and TX-A0007 are one incident and always share a timestamp.
//   * case  <-> alert: a case is opened FROM its alerts, so its whole timeline (created/updated/closed,
//     events, notes, attachments) is re-anchored to the oldest linked alert instead of drifting away from it.
//   * notes / attachments tied to an alert follow that alert.
//
// Invariants that keep the UI free of contradictions: every derived clock (slaDueAt, case.updatedAt,
// case.closedAt) is recomputed LAST from the final createdAt; generated times never exceed now.
export function refresh(): { alerts24h: number; alertDays: number; transactions24h: number } {
  const st = getStore();
  const now = Date.now();
  // Snapped clock used for every generated slot, so two hits within SNAP of each other are identical.
  const sn = Math.floor(now / SNAP) * SNAP;
  const m = st.meta as Seed["meta"] & { refreshedAt?: string };
  const since = sn - 24 * HR;

  // Snapshot the pre-refresh clock so relationships can be re-anchored with a per-record delta afterwards.
  const oldAlertAt = new Map(st.alerts.map((a) => [a.id, Date.parse(a.createdAt)]));
  const oldCaseAt = new Map(st.cases.map((c) => [c.id, Date.parse(c.createdAt)]));

  // --- 1. Alerts: spread each severity group across DAYS days on its own, so every day keeps a mix and a
  // severe alert is never lost in the distant past. Groups are laid out lowest severity first (oldest), so
  // HIGH / CRITICAL incidents land closer to now. ---
  const RANK: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
  const seedAlerts = st.alerts.filter((a) => /^ALT-\d+$/.test(a.id));
  const byRank = new Map<number, Alert[]>();
  for (const a of seedAlerts) {
    const r = RANK[a.aiLevel ?? a.baselineLevel] ?? 0;
    const bucket = byRank.get(r);
    if (bucket) bucket.push(a); else byRank.set(r, [a]);
  }
  for (const r of [...byRank.keys()].sort((x, y) => x - y)) {
    const group = byRank.get(r)!;
    group.sort((a, b) => a.id.localeCompare(b.id)); // stable: lower id -> older slot
    const slots = historicalSlots(group.length, sn, DAYS);
    group.forEach((a, i) => { a.createdAt = slots[i]; });
  }

  // --- 2. The transaction behind a seed alert shares its timestamp (one incident). ---
  const txById = new Map(st.transactions.map((t) => [t.id, t]));
  for (const a of seedAlerts) { const t = txById.get(a.transactionId); if (t) t.createdAt = a.createdAt; }

  // --- 3. Remaining synthetic traffic / sessions follow the same 30-day shape. ---
  const anchored = new Set(seedAlerts.map((a) => a.transactionId));
  for (const [list, re, key] of [
    [st.transactions, /^TX-A\d+$/, "createdAt"],
    [st.transactions, /^TX-\d+$/, "createdAt"],
    [st.sessions, /^SES-A\d+$/, "startedAt"],
  ] as [object[], RegExp, string][]) {
    const rows = list.filter((x) => re.test((x as { id: string }).id) && !anchored.has((x as { id: string }).id));
    rows.sort((a, b) => (a as { id: string }).id.localeCompare((b as { id: string }).id));
    const slots = historicalSlots(rows.length, sn, DAYS);
    rows.forEach((x, i) => { (x as Record<string, unknown>)[key] = slots[i]; });
  }

  // --- 4. Re-anchor each case to its oldest linked alert: a case is opened FROM its alerts, so the two must
  // not drift apart (otherwise the timeline shows a case created after the very alert that raised it). The
  // shift is applied to the case's own timestamps, its events, and the notes / attachments that belong to it. ---
  const alertById = new Map(st.alerts.map((a) => [a.id, a]));
  const shift = (iso: string, ms: number) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(Math.min(t + ms, sn)).toISOString() : iso; };
  const caseDelta = new Map<string, number>();
  for (const c of st.cases) {
    const linked = c.alertIds.map((id) => alertById.get(id)).filter((a): a is Alert => !!a);
    const old = oldCaseAt.get(c.id);
    if (!linked.length || old === undefined) continue;
    const oldest = linked.reduce((min, a) => Math.min(min, Date.parse(a.createdAt)), Infinity);
    const target = Math.min(oldest + 5 * 60e3, sn); // opened right after the first alert, never in the future
    const d = target - old;
    if (!Number.isFinite(d)) continue;
    caseDelta.set(c.id, d);
    c.createdAt = new Date(target).toISOString();
    c.updatedAt = shift(c.updatedAt, d);
    c.slaDueAt = new Date(Date.parse(c.createdAt) + SLA_H[c.priority as keyof typeof SLA_H] * HR).toISOString(); // derived, not shifted
    if (c.closedAt) c.closedAt = shift(c.closedAt, d);
    for (const e of c.events) e.at = shift(e.at, d);
  }
  // Notes / attachments: follow the record they belong to (a case, or a single alert).
  for (const rec of [...st.notes, ...st.attachments] as { entity: string; at: string }[]) {
    const [kind, id] = rec.entity.split(":");
    if (kind === "case") { const d = caseDelta.get(id); if (d) rec.at = shift(rec.at, d); }
    else if (kind === "alert") {
      const a = alertById.get(id), o = oldAlertAt.get(id);
      if (a && o !== undefined) { const d = Date.parse(a.createdAt) - o; if (Number.isFinite(d) && d) rec.at = shift(rec.at, d); }
    }
  }

  // Decisions follow the alert they were made on, so "decided at" stays after the alert it decides.
  for (const d of st.decisions) {
    const a = alertById.get(d.alertId), o = oldAlertAt.get(d.alertId);
    if (a && o !== undefined) { const dd = Date.parse(a.createdAt) - o; if (Number.isFinite(dd) && dd) d.decidedAt = shift(d.decidedAt, dd); }
  }

  // --- 5. Derived clocks, from the final createdAt, so they can never contradict it. ---
  for (const a of st.alerts) {
    const due = Date.parse(a.createdAt) + SLA_H[(a.aiLevel ?? a.baselineLevel) as keyof typeof SLA_H] * HR;
    a.slaDueAt = new Date(due).toISOString();
    if (a.escalated && a.escalatedAt) { const t = Date.parse(a.escalatedAt); if (!Number.isFinite(t) || t > sn) a.escalatedAt = new Date(Math.min(sn, due)).toISOString(); }
  }
  // A case's updatedAt must reflect its newest activity of ANY kind: a status event, a note, or an
  // attachment. Otherwise the detail page shows a note dated after the "last updated" stamp.
  const newestTouch = new Map<string, number>();
  for (const rec of [...st.notes, ...st.attachments] as { entity: string; at: string }[]) {
    const [kind, id] = rec.entity.split(":");
    if (kind !== "case") continue;
    const t = Date.parse(rec.at);
    if (Number.isFinite(t)) newestTouch.set(id, Math.max(newestTouch.get(id) ?? 0, t));
  }
  for (const c of st.cases) {
    const fromEvents = c.events.reduce((max, e) => Math.max(max, Date.parse(e.at) || 0), Date.parse(c.createdAt));
    const newest = Math.max(fromEvents, newestTouch.get(c.id) ?? 0);
    if (Number.isFinite(newest) && Date.parse(c.updatedAt) < newest) c.updatedAt = new Date(Math.min(newest, sn)).toISOString();
    if (c.updatedAt < c.createdAt) c.updatedAt = c.createdAt;
    if (c.closedAt && c.closedAt < c.createdAt) c.closedAt = c.updatedAt;
    if (c.closedAt && c.closedAt < c.updatedAt) c.closedAt = c.updatedAt; // a closed case is always as new as its last touch
  }

  m.refreshedAt = new Date(sn).toISOString();
  const days = new Set(st.alerts.filter((a) => Date.parse(a.createdAt) >= sn - DAYS * 24 * HR).map((a) => new Date(Date.parse(a.createdAt) + 7 * HR).toISOString().slice(0, 10)));
  return {
    alerts24h: st.alerts.filter((a) => Date.parse(a.createdAt) >= since).length,
    alertDays: days.size,
    transactions24h: st.transactions.filter((t) => Date.parse(t.createdAt) >= since).length,
  };
}
// Runtime state survives restarts as one JSON file (data/runtime/state.json); delete it or call /api/demo/reset to start over.
// shortcut: whole-state JSON snapshot every 3 s (last ≤3 s of changes can be lost on a crash), move to a database before production.
export const RUNTIME = join(/*turbopackIgnore: true*/ process.cwd(), "data", "runtime");
const FILE = join(RUNTIME, "state.json");
let last = "";
export function saveJson(file: string, data: string) {
  mkdirSync(RUNTIME, { recursive: true });
  writeFileSync(file + ".tmp", data); renameSync(file + ".tmp", file); // atomic replace: a crash mid-write never leaves a half file
}
function persist() {
  if (!g.__fortify) return;
  const data = JSON.stringify(g.__fortify);
  if (data !== last) { saveJson(FILE, data); last = data; }
}
// Write the current state to disk now instead of waiting for the 3 s snapshot interval (demo refresh must be durable).
export function persistNow() { persist(); }
function restore(): State | null {
  if (!existsSync(FILE)) return null;
  try {
    const st = JSON.parse(readFileSync(FILE, "utf8")) as State;
    for (const inv of Object.values(st.investigations)) if (inv.status === "running") Object.assign(inv, { status: "failed", error: "server restarted during investigation" });
    return st;
  } catch { return null; } // corrupt file: fall back to fresh seed rather than refusing to start
}

// One-time: state saved before the seed was translated keeps working data (alerts, cases, decisions…) but its reference
// data and generated labels move to English: reason codes, playbooks, AI fallbacks, network labels, seed rule names,
// placeholder beneficiary names, stored AI reports, rule names in alert hits, and logged customer messages.
function englishOnce(st: State & { englishV1?: boolean }) {
  if (st.englishV1) return;
  st.englishV1 = true;
  const fresh = loadSeed();
  Object.assign(st, { reasonCodes: fresh.reasonCodes, kb: fresh.kb, fallbacks: fresh.fallbacks, attackTemplate: fresh.attackTemplate });
  for (const [k, n] of Object.entries(fresh.network)) if (st.network[k]) st.network[k].nodes = st.network[k].nodes.map((x) => ({ ...x, label: n.nodes.find((y) => y.id === x.id)?.label ?? x.label }));
  const seedRules = json<{ name: string; description: string }[]>("rules.json");
  seedRules.forEach((r, i) => { const x = st.rules.find((y) => y.id === `RULE-${String(i + 1).padStart(4, "0")}`); if (x && /\b(Blokir|Tolak|Transfer kecil|Perangkat berisiko|Akses luar negeri|Nomor rekening|dini hari)\b/.test(`${x.name} ${x.description}`)) Object.assign(x, { name: r.name, description: r.description }); }); // only untouched seed rules
  const ben = (n: string) => n.replace(/^Penerima Baru /, "New Beneficiary ").replace(/^Penerima rutin$/, "Regular beneficiary").replace(/^Penerima /, "Beneficiary ");
  for (const t of st.transactions) t.beneficiary.name = ben(t.beneficiary.name);
  for (const a of st.alerts) for (const h of a.hits ?? []) if (h.kind === "RULE") h.value = st.rules.find((r) => r.id === h.ref)?.name ?? h.value;
  const budi = fresh.fallbacks["budi-report"] as Investigation["report"];
  for (const inv of Object.values(st.investigations)) if (inv.fallback && inv.report && /dikendalikan|nasabah|rekening/.test(inv.report.headline + inv.report.summary)) inv.report = budi;
  const msg: [RegExp, string][] = [
    [/^(.+?): kode verifikasi transfer Rp (\S+) ke (.+?) adalah (\d+)\. Berlaku (\d+) menit\. JANGAN berikan kode ini kepada siapa pun\.$/, "$1: your verification code for the Rp $2 transfer to $3 is $4. Valid for $5 minutes. NEVER share this code with anyone."],
    [/^(.+?): transfer Rp (\S+) ke (.+?) kami batalkan demi keamanan Anda\. Hubungi 14041 jika ini Anda\.$/, "$1: we cancelled your Rp $2 transfer to $3 for your security. If this was you, call 14041."],
    [/^(.+?): rekening Anda sementara kami amankan karena aktivitas mencurigakan\. Hubungi 14041\.$/, "$1: your account has been temporarily secured because of suspicious activity. Please call 14041."],
    [/^(.+?): transfer Rp (\S+) ke (.+?) telah diproses\.$/, "$1: your Rp $2 transfer to $3 has been processed."],
  ];
  for (const m of st.messages) for (const [re, to] of msg) if (re.test(m.text)) { m.text = m.text.replace(re, to); break; }
}

// One-time: give every seed beneficiary account a believable identity. Seed transactions reused a single
// account across several banks and named it "Beneficiary 0001-1"; here each account keeps one bank, and its
// name reads like a real counterparty (always masked). Only the synthetic ACC-KB-* /
// ACC-NB-* accounts are touched; a name typed by a customer at runtime is left exactly as submitted.
function beneficiaryNamesOnce(st: State & { beneficiaryNamesV2?: boolean }) {
  if (st.beneficiaryNamesV2) return;
  st.beneficiaryNamesV2 = true;
  const cache = new Map<string, { bankName: string; name: string }>();
  for (const t of st.transactions) {
    const b = t.beneficiary;
    if (!b?.accountId || !/^ACC-(KB|NB)-/.test(b.accountId)) continue;
    let id = cache.get(b.accountId);
    if (!id) { id = beneficiaryIdentity(b.accountId); cache.set(b.accountId, id); }
    b.bankName = id.bankName;
    b.name = id.name;
  }
}

export function getStore(): State {
  g.__fortify ??= restore() ?? reset();
  const st = g.__fortify;
  st.workflows = st.workflows ? st.workflows.map(migrate) : SEED_WORKFLOWS(); st.nextWfSeq ??= st.workflows.length + 1; st.reportSchedules ??= []; st.nextSchedSeq ??= 1; // Default workflows: give each built-in route exactly one owner (by role, else the first workflow with the default name).
  for (const [t, name] of Object.entries(DEFAULT_NAME ?? {}) as [keyof typeof DEFAULT_NAME, string][]) {
    if (st.workflows.some((w) => w.role === t)) continue;
    const w = st.workflows.find((x) => x.name === name);
    if (w) { w.role = t; delete w.endpoint; } // a default workflow is never published on a custom route
  }
  for (const [k, v] of Object.entries(INTEL_DEFAULTS())) (st as unknown as Record<string, unknown>)[k] ??= v;
  for (const c of st.customers) c.phone ??= phoneOf(c.id);
  // Sequence counters must be numbers: one that went missing / NaN (and was saved as null) is rebuilt from the highest id in use.
  const next = (ids: string[]) => Math.max(0, ...ids.map((i) => Number(i.replace(/\D/g, "")) || 0)) + 1;
  const seqs: [keyof State, () => number][] = [["nextWfSeq", () => next(st.workflows.map((w) => w.id))], ["nextCaseSeq", () => next(st.cases.map((c) => c.id))], ["nextSchedSeq", () => next(st.reportSchedules.map((x) => x.id))],
    ["nextRuleSeq", () => next(st.rules.map((r) => r.id))], ["nextAlertSeq", () => next(st.alerts.map((a) => a.id))], ["nextIntelSeq", () => Math.max(100, next([...st.watchlist.map((e) => e.id), ...st.amlList.map((e) => e.id), ...st.events.map((e) => e.id)]))]];
  for (const [k, f] of seqs) if (!Number.isFinite(st[k] as number)) (st as unknown as Record<string, number>)[k] = f();
  // Scenario seed is additive: anything missing (by id) is added to existing state, nothing is overwritten.
  try {
    const sc = scenarios(), has = <T extends { id: string }>(xs: T[]) => new Set(xs.map((x) => x.id));
    const cs = has(st.customers), ss = has(st.sessions), as = has(st.amlList);
    st.customers.push(...sc.customers.filter((c) => !cs.has(c.id)));
    st.sessions.push(...scenarioSessions(sc).filter((x) => !ss.has(x.id)));
    for (const [k, v] of Object.entries(sc.network)) st.network[k] ??= v;
    st.amlList.push(...sc.aml.filter((a) => !as.has(a.id)).map((a) => ({ ...a, createdAt: new Date().toISOString() })));
  } catch (e) { console.warn("[fortify] scenario seed skipped:", (e as Error).message); }
  try { englishOnce(st); } catch (e) { console.warn("[fortify] English migration skipped:", (e as Error).message); } // never take the store down
  try { beneficiaryNamesOnce(st); } catch (e) { console.warn("[fortify] beneficiary name migration skipped:", (e as Error).message); }
  seedDemo(st); // demo cases / watchlist / events, once (also for fresh state after reset)
  seedDecisions(st); // seeded analyst decisions (fraud / not-fraud), once — feeds fraudDetected + falsePositiveRate
  for (const a of st.alerts) a.slaDueAt ??= new Date(Date.parse(a.createdAt) + SLA_H[(a.aiLevel ?? a.baselineLevel) as keyof typeof SLA_H] * 3600e3).toISOString(); // state from before workflows existed (file or hot reload)
  (g as { __fortifySaver?: NodeJS.Timeout }).__fortifySaver ??= setInterval(persist, 3000).unref(); // outside the ??= so a hot-reloaded server also starts saving
  return g.__fortify;
}
