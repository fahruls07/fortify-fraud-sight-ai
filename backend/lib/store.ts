import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateRule, type Rule } from "./rules/dsl.ts";
import { DEFAULT_NAME, migrate, SEED_WORKFLOWS, type Workflow } from "./workflows.ts";
import { seedDemo } from "./demoseed.ts";
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
  const now = Date.now(), NOISE = 140, times = spread(NOISE, segments(now - 24 * HR, now));
  // Today's normal traffic: the share of the 6000-transfer day that has happened so far (WIB midnight .. now).
  const midnight = Math.floor((now + 7 * HR) / (24 * HR)) * 24 * HR - 7 * HR;
  const wDay = HOURLY.reduce((x, y) => x + y, 0), wSoFar = segments(midnight, now).reduce((x, y) => x + y.w, 0);
  const todayTx = json<Transaction[]>("transactions.json").filter((t) => t.id.startsWith("TX-T"));
  const todayAt = spread(Math.round(todayTx.length * wSoFar / wDay), segments(midnight, now));
  const normal = todayTx.slice(0, todayAt.length).map((t, i) => ({ ...t, createdAt: todayAt[i] }));
  const noiseAt = (id: string, re: RegExp) => { const m = id.match(re); return m && Number(m[1]) <= NOISE ? times[Number(m[1]) - 1] : null; };
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
  g.__fortify = { ...seed, fallbackOnly: g.__fortify?.fallbackOnly ?? false, audit: [], decisions: [], recommendations: {}, investigations: {}, rules, nextRuleSeq: rules.length + 1, workflows: SEED_WORKFLOWS(), nextWfSeq: 6, reportSchedules: [], nextSchedSeq: 1, ...INTEL_DEFAULTS(), nextAlertSeq, nextTxSeq: 1, nextInvSeq: 1 };
  return g.__fortify;
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
  seedDemo(st); // demo cases / watchlist / events, once (also for fresh state after reset)
  for (const a of st.alerts) a.slaDueAt ??= new Date(Date.parse(a.createdAt) + SLA_H[(a.aiLevel ?? a.baselineLevel) as keyof typeof SLA_H] * 3600e3).toISOString(); // state from before workflows existed (file or hot reload)
  (g as { __fortifySaver?: NodeJS.Timeout }).__fortifySaver ??= setInterval(persist, 3000).unref(); // outside the ??= so a hot-reloaded server also starts saving
  return g.__fortify;
}
