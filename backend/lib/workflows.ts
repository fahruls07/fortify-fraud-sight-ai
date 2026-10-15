import { compile } from "./expr.ts";
import { matches, type Features, type Rule } from "./rules/dsl.ts";
import { evaluateRules } from "./ruleengine.ts";
import { HIGH_RISK_COUNTRIES } from "./intel.ts";

// Fraud workflows over a shared variable context. Data nodes (AI, API, database, calculation, calculated field, scoring, rule)
// write variables; logic nodes (condition, criteria, rule, gateway) route; action nodes record what would happen (shadow mode).
export const TRIGGERS = { transaction_created: "Transaction Created", login_attempt: "Login Attempt", account_update: "Account Update" } as const;
export const SOURCES = { any: "Any source", mobile_app: "Mobile app", internet_banking: "Internet banking", core_banking: "Core banking" } as const;

// Event fields every run starts with.
export const FIELDS = {
  amount: { label: "Amount (IDR)", type: "number" }, velocity: { label: "Velocity (tx / hour)", type: "number" }, hour_of_day: { label: "Hour of day (WIB)", type: "number" },
  avg_daily_spend: { label: "Customer avg daily spend", type: "number" }, beneficiary_age_days: { label: "Beneficiary account age (days)", type: "number" },
  copy_paste: { label: "Copy-paste on beneficiary field", type: "number" }, shared_device_with: { label: "Accounts sharing beneficiary device", type: "number" },
  new_device: { label: "New device", type: "boolean" }, geo_anomaly: { label: "Geo anomaly", type: "boolean" }, new_beneficiary: { label: "New beneficiary", type: "boolean" },
  failed_attempts: { label: "Failed login / PIN attempts", type: "number" }, pin_correct: { label: "PIN correct, no failed tries", type: "boolean" }, login_success: { label: "Login credentials correct", type: "boolean" }, recent_new_device_login: { label: "New-device login in the last hour", type: "boolean" },
  on_blacklist: { label: "On a blacklist", type: "boolean" }, on_whitelist: { label: "On a whitelist", type: "boolean" },
  vpn: { label: "VPN detected", type: "boolean" }, rooted: { label: "Rooted device", type: "boolean" }, screen_sharing: { label: "Screen-sharing app", type: "boolean" },
  ip_country: { label: "IP country", type: "string" }, change_type: { label: "Account change type", type: "string" }, beneficiary_name: { label: "Beneficiary name", type: "string" }, customer_name: { label: "Customer name", type: "string" }, channel: { label: "Channel", type: "string" }, customer_id: { label: "Customer ID", type: "string" }, beneficiary_account: { label: "Beneficiary account", type: "string" },
} as const;
export type Field = keyof typeof FIELDS;
type StrField = { [K in Field]: (typeof FIELDS)[K]["type"] extends "string" ? K : never }[Field];
export const CONDITIONS = Object.fromEntries(Object.entries(FIELDS).filter(([, f]) => f.type !== "string").map(([k, f]) => [k, { label: f.label, type: f.type, ops: f.type === "number" ? [">", ">=", "<", "<=", "=="] : ["=="] }])) as Record<Exclude<Field, StrField>, { label: string; type: "number" | "boolean"; ops: string[] }>;
export type CondField = keyof typeof CONDITIONS;

export const ACTIONS = { block_transaction: "Block Transaction", challenge_customer: "Challenge Customer (OTP)", flag_for_review: "Flag for Review", send_alert: "Send Alert", notify_user: "Notify User" } as const;
export const TARGETS = { fraud_team: "Fraud team", customer: "Customer", core_banking: "Core banking", soc: "Security operations" } as const;
export const GATEWAYS = { exclusive: "Exclusive (XOR): first matching branch only", parallel: "Parallel (AND): all branches; join waits for all", inclusive: "Inclusive (OR): every matching branch" } as const;
export const CRITERIA_OPS = ["==", "!=", ">", ">=", "<", "<=", "contains", "in"] as const;
export const DB_QUERIES = {
  customer_tx_count_24h: "Customer: transactions in last 24 h", customer_tx_amount_24h: "Customer: total amount in last 24 h", customer_avg_amount_30d: "Customer: average amount, last 30 days",
  customer_open_alerts: "Customer: open alerts", customer_fraud_count: "Customer: confirmed fraud cases", beneficiary_alert_count: "Beneficiary: alerts involving this account",
  beneficiary_shared_devices: "Beneficiary: accounts sharing its device",
} as const;
export const STATUSES = ["Draft", "Active", "Archived"] as const;

export type Trigger = keyof typeof TRIGGERS; export type WfAction = keyof typeof ACTIONS; export type Target = keyof typeof TARGETS;
export type Check = { field: CondField; operator: string; value: number | boolean };
export type Crit = { field: string; operator: (typeof CRITERIA_OPS)[number]; value: string | number | boolean };
export type ScoreItem = Crit & { points: number };
type Pos = { position?: { x: number; y: number } };
export type WfNode = Pos & { id: string } & (
  | { type: "trigger"; data: { event: Trigger; source: keyof typeof SOURCES } }
  | { type: "condition"; data: { mode: "AND" | "OR"; conditions: Check[] } }
  | { type: "criteria"; data: { mode: "AND" | "OR"; criteria: Crit[] } }
  | { type: "rule"; data: { ruleId: string; output: string } }
  | { type: "gateway"; data: { kind: keyof typeof GATEWAYS } }
  | { type: "timer"; data: { minutes: number } }
  | { type: "calculation"; data: { expression: string; output: string } }
  | { type: "calc_field"; data: { input: string; output: string; buckets: { max: number; label: string }[]; otherwise: string } }
  | { type: "scoring"; data: { output: string; base: number; items: ScoreItem[] } }
  | { type: "db_query"; data: { query: keyof typeof DB_QUERIES; output: string } }
  | { type: "api_call"; data: { method: "GET" | "POST"; url: string; body: string; path: string; output: string } }
  | { type: "ai"; data: { prompt: string; output: string } }
  | { type: "aml_check"; data: { output: string; failOnHit: boolean } }
  | { type: "baseline_score"; data: BaselineCfg }
  | { type: "rule_engine"; data: { output: string } }
  | { type: "event_score"; data: EventScoreCfg }
  | { type: "action"; data: { action: WfAction; target: Target; params: Record<string, string> } }
  | { type: "parallel_action"; data: { actions: { action: WfAction; target: Target }[] } }
);
export interface BaselineCfg {
  output: string; spikeMultiple: number; youngDays: number; highValue: number; mediumAt: number; highAt: number;
  weights: { amountSpike: number; newBeneficiary: number; youngAccount: number; takeover: number; knownDevice: number; cleanPin: number; over50x: number; over200x: number };
}
export const BASELINE_DEFAULT: BaselineCfg = { output: "baseline", spikeMultiple: 10, youngDays: 30, highValue: 100_000_000, mediumAt: 30, highAt: 60,
  weights: { amountSpike: 25, newBeneficiary: 15, youngAccount: 10, takeover: 15, knownDevice: -10, cleanPin: -5, over50x: 15, over200x: 30 } };
export const BASELINE_LABEL: Record<keyof BaselineCfg["weights"], string> = {
  amountSpike: "Amount over N× daily spend", newBeneficiary: "New beneficiary", youngAccount: "Beneficiary account younger than N days", takeover: "New device with failed PIN",
  knownDevice: "Usual (known) device", cleanPin: "PIN correct, no failed tries", over50x: "Extra: amount over 50× daily spend", over200x: "Extra: amount over 200× daily spend",
};
// Same factors as the built-in baseline (lib/scoring.ts + amount escalation), with every weight and threshold editable.
export function baseline(c: BaselineCfg, ctx: Ctx) {
  const n = (k: string) => (typeof ctx[k] === "number" ? (ctx[k] as number) : 0), ratio = n("amount") / Math.max(n("avg_daily_spend"), 1), w = c.weights, why: string[] = [];
  let score = 0;
  const add = (on: boolean, pts: number, t: string) => { if (on && pts) { score += pts; why.push(`${pts > 0 ? "+" : ""}${pts} ${t}`); } };
  add(ratio > c.spikeMultiple, w.amountSpike, `amount ${Math.round(ratio)}× daily spend`);
  add(ratio > 200, w.over200x, "over 200×"); add(ratio > 50 && ratio <= 200, w.over50x, "over 50×");
  add(!!ctx.new_beneficiary, w.newBeneficiary, "new beneficiary"); add(n("beneficiary_age_days") < c.youngDays, w.youngAccount, `account < ${c.youngDays} d`);
  add(!!ctx.new_device && n("failed_attempts") > 0, w.takeover, "new device + failed PIN"); add(!ctx.new_device, w.knownDevice, "known device"); add(!!ctx.pin_correct, w.cleanPin, "clean PIN");
  score = Math.max(0, score);
  if (c.highValue > 0 && n("amount") >= c.highValue && score < c.mediumAt) { score = c.mediumAt; why.push(`high-value ≥ ${c.highValue.toLocaleString("en-US")} → at least medium`); }
  return { score, level: score >= c.highAt ? "HIGH" : score >= c.mediumAt ? "MEDIUM" : "LOW", why };
}

// Login / account-update scoring (same factors as the built-in lib/intel.ts scoreEvent), every weight editable.
export interface EventScoreCfg {
  output: string; sensitive: string; challengeAt: number; denyAt: number;
  weights: { blacklisted: number; newDevice: number; foreignIp: number; highRiskCountry: number; perFailedAttempt: number; failedAttemptsCap: number; failedLogin: number; sensitiveChange: number; afterNewDeviceLogin: number; whitelisted: number };
}
export const EVENT_DEFAULT: EventScoreCfg = { output: "event", sensitive: "phone, email, password, pin, device, beneficiary_add, limit", challengeAt: 30, denyAt: 60,
  weights: { blacklisted: 60, newDevice: 25, foreignIp: 20, highRiskCountry: 15, perFailedAttempt: 10, failedAttemptsCap: 40, failedLogin: 5, sensitiveChange: 30, afterNewDeviceLogin: 20, whitelisted: -30 } };
export const EVENT_LABEL: Record<keyof EventScoreCfg["weights"], string> = {
  blacklisted: "Device / IP / account blacklisted", newDevice: "Unrecognised device", foreignIp: "IP outside home country", highRiskCountry: "IP from a high-risk country",
  perFailedAttempt: "Per failed password / PIN attempt", failedAttemptsCap: "Cap for failed attempts", failedLogin: "This login failed", sensitiveChange: "Sensitive account change",
  afterNewDeviceLogin: "Change right after a new-device login", whitelisted: "Whitelisted (and not blacklisted)",
};
export function eventScore(c: EventScoreCfg, ctx: Ctx) {
  const w = c.weights, why: string[] = [], n = (k: string) => (typeof ctx[k] === "number" ? (ctx[k] as number) : 0);
  let score = 0;
  const add = (on: boolean, pts: number, t: string) => { if (on && pts) { score += pts; why.push(`${pts > 0 ? "+" : ""}${pts} ${t}`); } };
  const change = String(ctx.change_type ?? "").trim().toLowerCase(), sens = c.sensitive.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  add(!!ctx.on_blacklist, w.blacklisted, "blacklisted"); add(!!ctx.new_device, w.newDevice, "unrecognised device");
  add(!!ctx.geo_anomaly, w.foreignIp, `foreign IP (${ctx.ip_country})`); add(HIGH_RISK_COUNTRIES.includes(String(ctx.ip_country)), w.highRiskCountry, "high-risk country");
  if (!change) { add(n("failed_attempts") > 0, Math.min(w.failedAttemptsCap, n("failed_attempts") * w.perFailedAttempt), `${n("failed_attempts")} failed attempt(s)`); add(ctx.login_success === false, w.failedLogin, "login failed"); }
  else { add(sens.includes(change), w.sensitiveChange, `sensitive change: ${change}`); add(!!ctx.recent_new_device_login, w.afterNewDeviceLogin, "right after a new-device login"); }
  if (ctx.on_whitelist && !ctx.on_blacklist && w.whitelisted) { score = Math.max(0, score + w.whitelisted); why.push(`${w.whitelisted} whitelisted`); }
  score = Math.max(0, Math.min(100, score));
  return { score, decision: score >= c.denyAt ? "DENY" : score >= c.challengeAt ? "CHALLENGE" : "ALLOW", why };
}

export type Kind = WfNode["type"];
export const KINDS: Record<Kind, { title: string; hint: string; group: "Flow" | "Logic" | "Data" | "Actions" }> = {
  trigger: { title: "Trigger", hint: "Starts the flow on an event", group: "Flow" },
  gateway: { title: "Gateway", hint: "Split or join paths", group: "Flow" },
  timer: { title: "Timer", hint: "Wait before continuing", group: "Flow" },
  condition: { title: "Condition", hint: "Check event fields", group: "Logic" },
  criteria: { title: "Criteria field", hint: "Check any variable, incl. calculated ones", group: "Logic" },
  rule: { title: "Rule", hint: "Call a Rule Builder rule", group: "Logic" },
  scoring: { title: "Scoring", hint: "Weighted scorecard → score", group: "Logic" },
  calculation: { title: "Calculation", hint: "Formula → number variable", group: "Data" },
  calc_field: { title: "Calculated field", hint: "Map a number to bands / labels", group: "Data" },
  db_query: { title: "Database query", hint: "Look up history from the database", group: "Data" },
  api_call: { title: "API call", hint: "Call an allowed external API", group: "Data" },
  ai: { title: "AI (Gemini)", hint: "Ask AI for a risk score", group: "Data" },
  aml_check: { title: "AML check", hint: "Sanctions / PEP / structuring screening", group: "Logic" },
  baseline_score: { title: "Baseline score", hint: "Built-in risk score, editable weights", group: "Logic" },
  rule_engine: { title: "Active rules", hint: "Run every active Rule Builder rule", group: "Logic" },
  event_score: { title: "Event score", hint: "Login / account-change risk, editable weights", group: "Logic" },
  action: { title: "Action", hint: "Do one thing", group: "Actions" },
  parallel_action: { title: "Parallel action", hint: "Do several things at once", group: "Actions" },
};

export interface WfEdge { source: string; target: string }
export interface WorkflowBody { name: string; description?: string; nodes: WfNode[]; edges: WfEdge[] }
export interface Version { version: number; savedAt: string; savedBy: string; note: string; name: string; description?: string; nodes: WfNode[]; edges: WfEdge[] }
export interface Run { at: string; ms: number; ok: boolean; fired: string[]; error?: string; ref?: string; mode?: "shadow" | "live"; decision?: string }
// A deployed workflow can be published as its own API endpoint (POST /api/flows/{slug}) that the banking app calls.
export interface Endpoint { slug: string; enabled: boolean; publishedAt: string; publishedBy: string; calls: number; lastCallAt?: string }
export interface Workflow extends WorkflowBody {
  id: string; status: (typeof STATUSES)[number]; version: number; versions: Version[]; deployedVersion?: number; deployedAt?: string;
  updatedAt: string; updatedBy: string; runs: Run[]; endpoint?: Endpoint;
  // Default workflows are permanently bound to a built-in route (see DEFAULT_ROUTE) and cannot be published elsewhere.
  role?: "transaction_created" | "login_attempt" | "account_update";
}
export const DEFAULT_ROUTE = { transaction_created: "/api/transactions/score", login_attempt: "/api/events/login", account_update: "/api/events/account-update" } as const;
export const DEFAULT_NAME = { transaction_created: "Default Transaction Scoring", login_attempt: "Default Login Scoring", account_update: "Default Account Update Scoring" } as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const has = <T extends object>(o: T, k: unknown): k is keyof T => typeof k === "string" && Object.hasOwn(o, k);
const VAR = /^[a-z][a-z0-9_]{0,30}$/;
const isVar = (v: unknown) => typeof v === "string" && VAR.test(v) && !has(FIELDS, v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function checkOf(c: unknown, at: string): Check | string {
  if (!isObj(c)) return `${at}: invalid condition.`;
  const def = has(CONDITIONS, c.field) ? CONDITIONS[c.field] : null;
  if (!def) return `${at}: field must be one of ${Object.keys(CONDITIONS).join(", ")}.`;
  if (!def.ops.includes(String(c.operator))) return `${at}: operator for ${String(c.field)} must be ${def.ops.join(" ")}.`;
  if (def.type === "number" ? !Number.isFinite(c.value) : typeof c.value !== "boolean") return `${at}: ${String(c.field)} value must be a ${def.type === "number" ? "number" : "true/false"}.`;
  return { field: c.field as CondField, operator: String(c.operator), value: c.value as number | boolean };
}
function critOf(c: unknown, at: string): Crit | string {
  if (!isObj(c) || typeof c.field !== "string" || !/^[a-z][a-z0-9_]{0,30}$/.test(c.field)) return `${at}: each criterion needs a variable name.`;
  if (!CRITERIA_OPS.includes(c.operator as never)) return `${at}: operator must be one of ${CRITERIA_OPS.join(" ")}.`;
  if (!["string", "number", "boolean"].includes(typeof c.value) || (typeof c.value === "number" && !Number.isFinite(c.value)) || String(c.value).length > 200) return `${at}: value must be text, a number or true/false.`;
  return { field: c.field, operator: c.operator as Crit["operator"], value: c.value as Crit["value"] };
}
const actionOf = (d: Record<string, unknown>, at: string): { action: WfAction; target: Target } | string =>
  !has(ACTIONS, d.action) ? `${at}: action must be one of ${Object.keys(ACTIONS).join(", ")}.` : !has(TARGETS, d.target ?? "fraud_team") ? `${at}: target must be one of ${Object.keys(TARGETS).join(", ")}.` : { action: d.action, target: (d.target ?? "fraud_team") as Target };

// Trust boundary for saves and imports. Also upgrades the older shapes (single condition, AND/OR gateways).
export function validateWorkflow(raw: unknown): { error: string } | { workflow: WorkflowBody } {
  if (!isObj(raw)) return { error: "Workflow must be a JSON object." };
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 80) return { error: "Workflow name is required (max 80 characters)." };
  if (!Array.isArray(raw.nodes) || !raw.nodes.length || raw.nodes.length > 200) return { error: "Workflow needs 1–200 nodes." };
  if (!Array.isArray(raw.edges) || raw.edges.length > 500) return { error: "edges must be an array (max 500)." };
  const nodes: WfNode[] = [], ids = new Set<string>();
  for (const n of raw.nodes) {
    if (!isObj(n) || typeof n.id !== "string" || !n.id || n.id.length > 40 || ids.has(n.id)) return { error: "Every node needs a unique string id." };
    ids.add(n.id);
    const d = isObj(n.data) ? n.data : {}, at = `Node ${n.id}`, id = n.id;
    const position = isObj(n.position) && Number.isFinite(n.position.x) && Number.isFinite(n.position.y) ? { x: n.position.x as number, y: n.position.y as number } : undefined;
    const out = (fallback: string) => { const o = d.output ?? fallback; return isVar(o) ? (o as string) : null; };
    const bad = (m: string) => ({ error: `${at}: ${m}` });
    switch (n.type) {
      case "trigger": {
        if (!has(TRIGGERS, d.event)) return bad(`event must be one of ${Object.keys(TRIGGERS).join(", ")}.`);
        const source = d.source ?? "any"; if (!has(SOURCES, source)) return bad(`data source must be one of ${Object.keys(SOURCES).join(", ")}.`);
        nodes.push({ id, type: "trigger", data: { event: d.event, source }, position }); break;
      }
      case "condition": case "criteria": {
        const isC = n.type === "condition", list = (isC ? (Array.isArray(d.conditions) ? d.conditions : "field" in d ? [d] : []) : d.criteria) as unknown[];
        if (!Array.isArray(list) || !list.length || list.length > 10) return bad("add 1–10 checks.");
        const mode = d.mode ?? "AND"; if (mode !== "AND" && mode !== "OR") return bad("combine checks with AND or OR.");
        const xs = [];
        for (const c of list) { const x = isC ? checkOf(c, at) : critOf(c, at); if (typeof x === "string") return { error: x }; xs.push(x); }
        nodes.push(isC ? { id, type: "condition", data: { mode, conditions: xs as Check[] }, position } : { id, type: "criteria", data: { mode, criteria: xs as Crit[] }, position }); break;
      }
      case "rule": {
        if (typeof d.ruleId !== "string" || !/^RULE-\d{4}$/.test(d.ruleId)) return bad("pick a rule.");
        const o = out("rule_hit"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        nodes.push({ id, type: "rule", data: { ruleId: d.ruleId, output: o }, position }); break;
      }
      case "gateway": {
        const kind = d.kind ?? (d.mode === "AND" ? "parallel" : d.mode === "OR" ? "inclusive" : undefined);
        if (!has(GATEWAYS, kind)) return bad("gateway type must be exclusive, parallel or inclusive.");
        nodes.push({ id, type: "gateway", data: { kind }, position }); break;
      }
      case "timer":
        if (!Number.isInteger(d.minutes) || (d.minutes as number) < 1 || (d.minutes as number) > 10080) return bad("timer must be 1–10080 minutes.");
        nodes.push({ id, type: "timer", data: { minutes: d.minutes as number }, position }); break;
      case "calculation": {
        const o = out("calc"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        try { compile(String(d.expression ?? "")); } catch (e) { return bad((e as Error).message); }
        nodes.push({ id, type: "calculation", data: { expression: String(d.expression), output: o }, position }); break;
      }
      case "calc_field": {
        const o = out("band"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        if (typeof d.input !== "string" || !VAR.test(d.input)) return bad("input must be a variable name.");
        if (!Array.isArray(d.buckets) || !d.buckets.length || d.buckets.length > 10) return bad("add 1–10 bands.");
        const buckets = [];
        for (const b of d.buckets) { if (!isObj(b) || !Number.isFinite(b.max) || typeof b.label !== "string" || !b.label.trim()) return bad("each band needs an upper limit and a label."); buckets.push({ max: b.max as number, label: b.label.trim().slice(0, 40) }); }
        buckets.sort((a, b) => a.max - b.max);
        nodes.push({ id, type: "calc_field", data: { input: d.input, output: o, buckets, otherwise: str(d.otherwise, 40) || "other" }, position }); break;
      }
      case "scoring": {
        const o = out("score"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        if (!Array.isArray(d.items) || !d.items.length || d.items.length > 20) return bad("add 1–20 scoring factors.");
        const items: ScoreItem[] = [];
        for (const it of d.items) { const c = critOf(it, at); if (typeof c === "string") return { error: c }; const pts = (it as Record<string, unknown>).points; if (!Number.isFinite(pts) || Math.abs(pts as number) > 1000) return bad("points must be a number between -1000 and 1000."); items.push({ ...c, points: pts as number }); }
        nodes.push({ id, type: "scoring", data: { output: o, base: Number.isFinite(d.base) ? (d.base as number) : 0, items }, position }); break;
      }
      case "db_query": {
        if (!has(DB_QUERIES, d.query)) return bad(`query must be one of ${Object.keys(DB_QUERIES).join(", ")}.`);
        const o = out(d.query as string); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        nodes.push({ id, type: "db_query", data: { query: d.query, output: o }, position }); break;
      }
      case "api_call": {
        const o = out("api_result"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        if (d.method !== "GET" && d.method !== "POST") return bad("method must be GET or POST.");
        try { const u = new URL(String(d.url)); if (u.protocol !== "https:" && u.protocol !== "http:") throw 0; } catch { return bad("URL must start with http:// or https://."); }
        if (typeof d.path === "string" && d.path && !/^[\w.[\]-]{1,100}$/.test(d.path)) return bad("result path must look like data.score or items[0].risk.");
        nodes.push({ id, type: "api_call", data: { method: d.method, url: String(d.url), body: str(d.body, 2000), path: str(d.path, 100), output: o }, position }); break;
      }
      case "baseline_score": {
        const o = out("baseline"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        const W = isObj(d.weights) ? d.weights : {}, weights = { ...BASELINE_DEFAULT.weights };
        for (const k of Object.keys(weights) as (keyof typeof weights)[]) { const v = W[k] ?? weights[k]; if (!Number.isFinite(v) || Math.abs(v as number) > 1000) return bad(`weight ${k} must be a number between -1000 and 1000.`); weights[k] = v as number; }
        const num = (k: keyof BaselineCfg, min: number, max: number) => { const v = d[k] ?? BASELINE_DEFAULT[k]; return Number.isFinite(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null; };
        const cfg = { output: o, spikeMultiple: num("spikeMultiple", 1, 10000), youngDays: num("youngDays", 0, 3650), highValue: num("highValue", 0, 1e15), mediumAt: num("mediumAt", 0, 1000), highAt: num("highAt", 0, 1000), weights };
        if (Object.values(cfg).some((v) => v === null)) return bad("thresholds must be positive numbers.");
        if (cfg.highAt! <= cfg.mediumAt!) return bad("the High threshold must be above the Medium threshold.");
        nodes.push({ id, type: "baseline_score", data: cfg as BaselineCfg, position }); break;
      }
      case "event_score": {
        const o = out("event"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        const W = isObj(d.weights) ? d.weights : {}, weights = { ...EVENT_DEFAULT.weights };
        for (const k of Object.keys(weights) as (keyof typeof weights)[]) { const v = W[k] ?? weights[k]; if (!Number.isFinite(v) || Math.abs(v as number) > 1000) return bad(`weight ${k} must be a number between -1000 and 1000.`); weights[k] = v as number; }
        const ch = d.challengeAt ?? EVENT_DEFAULT.challengeAt, dn = d.denyAt ?? EVENT_DEFAULT.denyAt;
        if (!Number.isFinite(ch) || !Number.isFinite(dn) || (dn as number) <= (ch as number) || (ch as number) < 0) return bad("the Deny threshold must be above the Challenge threshold.");
        nodes.push({ id, type: "event_score", data: { output: o, sensitive: str(d.sensitive ?? EVENT_DEFAULT.sensitive, 300), challengeAt: ch as number, denyAt: dn as number, weights }, position }); break;
      }
      case "rule_engine": {
        const o = out("rules"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        nodes.push({ id, type: "rule_engine", data: { output: o }, position }); break;
      }
      case "aml_check": {
        const o = out("aml"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        nodes.push({ id, type: "aml_check", data: { output: o, failOnHit: d.failOnHit === true }, position }); break;
      }
      case "ai": {
        const o = out("ai_risk"); if (!o) return bad("output must be a lowercase variable name that is not an event field.");
        if (typeof d.prompt !== "string" || !d.prompt.trim()) return bad("write a question for the AI.");
        nodes.push({ id, type: "ai", data: { prompt: d.prompt.slice(0, 1000), output: o }, position }); break;
      }
      case "action": {
        const a = actionOf(d, at); if (typeof a === "string") return { error: a };
        const params: Record<string, string> = {};
        if (d.params !== undefined && !isObj(d.params)) return bad("parameters must be key/value text.");
        for (const [k, v] of Object.entries(d.params ?? {})) { if (!/^[a-z][\w-]{0,30}$/i.test(k) || typeof v !== "string" || v.length > 500) return bad(`parameter "${k}" needs a simple name and text up to 500 characters.`); params[k] = v; }
        if (Object.keys(params).length > 10) return bad("at most 10 parameters.");
        nodes.push({ id, type: "action", data: { ...a, params }, position }); break;
      }
      case "parallel_action": {
        if (!Array.isArray(d.actions) || d.actions.length < 2 || d.actions.length > 10) return bad("add 2–10 actions.");
        const actions = [];
        for (const x of d.actions) { const a = actionOf(isObj(x) ? x : {}, at); if (typeof a === "string") return { error: a }; actions.push(a); }
        nodes.push({ id, type: "parallel_action", data: { actions }, position }); break;
      }
      default: return { error: `${at}: unknown node type "${String(n.type)}".` };
    }
  }
  if (!nodes.some((n) => n.type === "trigger")) return { error: "Add at least one Trigger node." };
  if (!nodes.some((n) => n.type === "action" || n.type === "parallel_action")) return { error: "Add at least one Action or Parallel action node." };
  const edges: WfEdge[] = [], seen = new Set<string>(), type = (id: string) => nodes.find((n) => n.id === id)!.type;
  for (const e of raw.edges) {
    if (!isObj(e) || !ids.has(e.source as string) || !ids.has(e.target as string)) return { error: "Every connection must link two existing nodes." };
    if (e.source === e.target) return { error: `Node ${e.source} cannot connect to itself.` };
    const k = `${e.source}>${e.target}`; if (seen.has(k)) continue; seen.add(k);
    if (type(e.target as string) === "trigger") return { error: `Trigger ${e.target} cannot have incoming connections.` };
    if (["action", "parallel_action"].includes(type(e.source as string))) return { error: `Action ${e.source} cannot have outgoing connections.` };
    edges.push({ source: e.source as string, target: e.target as string });
  }
  if (!order(nodes, edges)) return { error: "Workflow has a loop. Connections must flow one way from Trigger to Action." };
  const desc = typeof raw.description === "string" ? raw.description.trim().slice(0, 500) : undefined;
  return { workflow: { name: raw.name.trim(), ...(desc && { description: desc }), nodes, edges } };
}

// Topological order (Kahn); null when there is a cycle.
function order(nodes: WfNode[], edges: WfEdge[]) {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.target, indeg.get(e.target)! + 1);
  const q = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id), out: string[] = [];
  while (q.length) { const id = q.shift()!; out.push(id); for (const e of edges) if (e.source === id) { indeg.set(e.target, indeg.get(e.target)! - 1); if (!indeg.get(e.target)) q.push(e.target); } }
  return out.length === nodes.length ? out : null;
}

export type Ctx = Record<string, string | number | boolean | null>;
export interface TestEvent { event: Trigger; source: Exclude<keyof typeof SOURCES, "any">; fields: { [K in Field]: (typeof FIELDS)[K]["type"] extends "number" ? number : (typeof FIELDS)[K]["type"] extends "boolean" ? boolean : string } }
export const SAMPLE_FIELDS: TestEvent["fields"] = {
  amount: 25000000, velocity: 2, hour_of_day: 23, avg_daily_spend: 500000, beneficiary_age_days: 9, copy_paste: 3, shared_device_with: 3,
  new_device: true, geo_anomaly: false, new_beneficiary: true, vpn: true, rooted: false, screen_sharing: true,
  failed_attempts: 0, pin_correct: true, login_success: true, recent_new_device_login: false, on_blacklist: false, on_whitelist: false, change_type: "", beneficiary_name: "Rizky Pratama", customer_name: "Budi Santoso",
  ip_country: "RU", channel: "MOBILE_APP", customer_id: "CUST-0001", beneficiary_account: "ACC-BEN-7781",
};

// Side-effecting lookups are injected so the engine stays pure and testable; the server wires the real ones.
export interface Services {
  rule: (id: string) => Rule | undefined;
  db: (query: keyof typeof DB_QUERIES, ctx: Ctx) => number;
  api: (n: Extract<WfNode, { type: "api_call" }>["data"], ctx: Ctx) => Promise<unknown>;
  ai: (prompt: string, ctx: Ctx) => Promise<{ score: number; label: string; reason: string; source: string }>;
  aml: (ctx: Ctx) => { hit: boolean; score: number; reasons: string[] };
  rules?: () => Rule[]; // all rules (only Active ones are evaluated)
}
export interface Step { id: string; type: Kind; label: string; reached: boolean; log: string[]; ms: number; error?: string; set?: Ctx }

const cmp = (v: unknown, o: string, t: unknown): boolean => {
  if (o === "contains") return String(v ?? "").toLowerCase().includes(String(t).toLowerCase());
  if (o === "in") return String(t).split(",").map((x) => x.trim().toLowerCase()).includes(String(v ?? "").toLowerCase());
  if (o === "==") return v === t || (typeof v !== "boolean" && String(v) === String(t));
  if (o === "!=") return !(v === t || (typeof v !== "boolean" && String(v) === String(t)));
  if (typeof v !== "number" || typeof t !== "number") return false;
  return o === ">" ? v > t : o === ">=" ? v >= t : o === "<" ? v < t : v <= t;
};
const featuresOf = (c: Ctx): Features => ({
  amount: c.amount as number, hourOfDay: c.hour_of_day as number, isNewBeneficiary: !!c.new_beneficiary, screenSharingAppDetected: c.screen_sharing ? "screen-sharing app" : null,
  isVpnDetected: !!c.vpn, ipCountry: (c.ip_country as string) ?? "ID", copyPasteEventsOnBeneficiaryField: (c.copy_paste as number) ?? 0, deviceRooted: !!c.rooted, sharedDeviceWith: (c.shared_device_with as number) ?? 0,
});
const tmpl = (s: string, c: Ctx) => s.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, k) => (Object.hasOwn(c, k) ? String(c[k]) : ""));
export const fill = tmpl;

export const labelOf = (n: WfNode): string => {
  const d = n.data as never as Record<string, unknown>;
  switch (n.type) {
    case "trigger": return `${TRIGGERS[n.data.event]} · ${SOURCES[n.data.source]}`;
    case "condition": return n.data.conditions.map((c) => `${c.field} ${c.operator} ${c.value}`).join(` ${n.data.mode} `);
    case "criteria": return n.data.criteria.map((c) => `${c.field} ${c.operator} ${c.value}`).join(` ${n.data.mode} `);
    case "rule": return `${n.data.ruleId} → ${n.data.output}`;
    case "gateway": return `${n.data.kind} gateway`;
    case "timer": return `wait ${n.data.minutes} min`;
    case "calculation": return `${n.data.output} = ${n.data.expression}`;
    case "calc_field": return `${n.data.output} = band(${n.data.input}): ${n.data.buckets.map((b) => `≤${b.max} ${b.label}`).join(", ")}, else ${n.data.otherwise}`;
    case "scoring": return `${n.data.output} = ${n.data.base} + ${n.data.items.length} factor${n.data.items.length === 1 ? "" : "s"}`;
    case "db_query": return `${n.data.output} = ${DB_QUERIES[n.data.query]}`;
    case "api_call": return `${n.data.method} ${(() => { try { return new URL(n.data.url).host; } catch { return n.data.url; } })()} → ${n.data.output}`;
    case "baseline_score": return `${n.data.output}_score / _level: baseline (medium ≥ ${n.data.mediumAt}, high ≥ ${n.data.highAt})`;
    case "rule_engine": return `${n.data.output}_action = strictest active rule`;
    case "event_score": return `${n.data.output}_score / _decision (challenge ≥ ${n.data.challengeAt}, deny ≥ ${n.data.denyAt})`;
    case "aml_check": return `${n.data.output}_hit / _score = AML screening${n.data.failOnHit ? " (continue only on a hit)" : ""}`;
    case "ai": return `${n.data.output} = AI(“${n.data.prompt.slice(0, 40)}${n.data.prompt.length > 40 ? "…" : ""}”)`;
    case "action": return `${ACTIONS[n.data.action]} → ${TARGETS[n.data.target]}`;
    case "parallel_action": return n.data.actions.map((a) => ACTIONS[a.action]).join(" ∥ ");
  }
  return String(d);
};

// Synchronous pass/fail of a node's own test against the current context (data nodes always pass).
function own(n: WfNode, ctx: Ctx, svc: Services, ev: { event: Trigger; source: string }): boolean {
  if (n.type === "trigger") return n.data.event === ev.event && (n.data.source === "any" || n.data.source === ev.source);
  if (n.type === "condition") { const r = n.data.conditions.map((c) => cmp(ctx[c.field], c.operator, c.value)); return n.data.mode === "AND" ? r.every(Boolean) : r.some(Boolean); }
  if (n.type === "criteria") { const r = n.data.criteria.map((c) => cmp(ctx[c.field], c.operator, c.value)); return n.data.mode === "AND" ? r.every(Boolean) : r.some(Boolean); }
  if (n.type === "rule") { const r = svc.rule(n.data.ruleId); return !!r && matches(r.condition, featuresOf(ctx)); }
  return true;
}

// Token-style evaluation in topological order. Split: exclusive enables only the first outgoing edge whose target would pass,
// inclusive every passing one, parallel all. Join: a parallel gateway needs all incoming edges, everything else any one.
export async function runWorkflow(w: WorkflowBody, ev: TestEvent, svc: Services) {
  const t0 = performance.now(), ids = order(w.nodes, w.edges)!, by = new Map(w.nodes.map((n) => [n.id, n]));
  const ctx: Ctx = { ...ev.fields }, live = new Set<string>(), reached = new Map<string, boolean>(), steps: Step[] = [], errors: string[] = [];
  for (const id of ids) {
    const s0 = performance.now(), n = by.get(id)!, ins = w.edges.filter((e) => e.target === id), log: string[] = [];
    const on = ins.filter((e) => live.has(`${e.source}>${e.target}`)).length;
    const set: Ctx = {}, put = (k: string, v: Ctx[string]) => { ctx[k] = v; set[k] = v; };
    let ok = false, error: string | undefined;
    if (n.type === "trigger") { ok = own(n, ctx, svc, ev); log.push(`event ${ev.event} from ${ev.source}: ${ok ? "matches" : "no match"}`); }
    else {
      const joined = n.type === "gateway" && n.data.kind === "parallel" ? ins.length > 0 && on === ins.length : on > 0;
      log.push(`input: ${on}/${ins.length} path${ins.length === 1 ? "" : "s"} active${n.type === "gateway" && n.data.kind === "parallel" ? " (needs all)" : ""}`);
      if (joined) {
        try {
          switch (n.type) {
            case "condition": case "criteria": {
              const list = n.type === "condition" ? n.data.conditions : n.data.criteria;
              for (const c of list) log.push(`${c.field} ${c.operator} ${c.value} → ${cmp(ctx[c.field], c.operator, c.value)} (value ${ctx[c.field] === undefined ? "missing" : JSON.stringify(ctx[c.field])})`);
              ok = own(n, ctx, svc, ev); log.push(`${n.data.mode} → ${ok ? "pass" : "fail"}`); break;
            }
            case "rule": {
              const r = svc.rule(n.data.ruleId);
              if (!r) throw new Error(`Rule ${n.data.ruleId} not found.`);
              ok = matches(r.condition, featuresOf(ctx)); put(n.data.output, ok);
              log.push(`${r.id} "${r.name}" (${r.status}): ${r.expression} → ${ok ? "match" : "no match"}`); break;
            }
            case "calculation": { const v = +compile(n.data.expression).run(ctx).toFixed(6); put(n.data.output, v); log.push(`${n.data.output} = ${n.data.expression} = ${v}`); ok = true; break; }
            case "calc_field": {
              const v = ctx[n.data.input];
              if (typeof v !== "number") throw new Error(`${n.data.input} is not a number.`);
              const label = n.data.buckets.find((b) => v <= b.max)?.label ?? n.data.otherwise;
              put(n.data.output, label); log.push(`${n.data.input} = ${v} → ${n.data.output} = "${label}"`); ok = true; break;
            }
            case "scoring": {
              let score = n.data.base;
              for (const it of n.data.items) { const hit = cmp(ctx[it.field], it.operator, it.value); if (hit) score += it.points; log.push(`${hit ? "+" : " "}${it.points} if ${it.field} ${it.operator} ${it.value}${hit ? " ✓" : ""}`); }
              put(n.data.output, score); log.push(`${n.data.output} = ${score}`); ok = true; break;
            }
            case "db_query": { const v = svc.db(n.data.query, ctx); put(n.data.output, v); log.push(`${DB_QUERIES[n.data.query]} → ${n.data.output} = ${v}`); ok = true; break; }
            case "api_call": {
              const raw = await svc.api(n.data, ctx);
              const v = n.data.path ? n.data.path.split(/[.[\]]/).filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === "object" && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined), raw) : raw;
              const val = typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : v === null || v === undefined ? null : JSON.stringify(v).slice(0, 200);
              put(n.data.output, val); log.push(`${n.data.method} ${n.data.url} → ${n.data.output} = ${JSON.stringify(val)}`); ok = true; break;
            }
            case "ai": {
              const r = await svc.ai(tmpl(n.data.prompt, ctx), ctx);
              put(n.data.output, r.score); put(`${n.data.output}_label`, r.label);
              log.push(`${r.source}: ${n.data.output} = ${r.score} (${r.label}) · ${r.reason}`); ok = true; break;
            }
            case "baseline_score": {
              const b = baseline(n.data, ctx);
              put(`${n.data.output}_score`, b.score); put(`${n.data.output}_level`, b.level);
              log.push(...b.why, `score ${b.score} → ${b.level}`); ok = true; break;
            }
            case "event_score": {
              const r = eventScore(n.data, ctx);
              put(`${n.data.output}_score`, r.score); put(`${n.data.output}_decision`, r.decision); put(`${n.data.output}_reasons`, r.why.join("; ") || "none");
              log.push(...r.why, `score ${r.score} → ${r.decision}`); ok = true; break;
            }
            case "rule_engine": {
              const o = evaluateRules(svc.rules?.() ?? [], featuresOf(ctx));
              put(`${n.data.output}_action`, o.action ?? "NONE"); put(`${n.data.output}_hit`, o.hits.length > 0); put(`${n.data.output}_names`, o.hits.map((h) => h.name).join("; ") || "none");
              log.push(o.hits.length ? `${o.hits.length} active rule(s) matched: ${o.hits.map((h) => `${h.id} ${h.action}`).join(", ")} → ${o.action}` : "no active rule matched"); ok = true; break;
            }
            case "aml_check": {
              const r = svc.aml(ctx);
              put(`${n.data.output}_hit`, r.hit); put(`${n.data.output}_score`, r.score); put(`${n.data.output}_reasons`, r.reasons.join("; ") || "none");
              log.push(`AML score ${r.score}${r.hit ? " → HIT" : ""}${r.reasons.length ? `: ${r.reasons.join("; ")}` : ""}`);
              ok = n.data.failOnHit ? r.hit : true; break;
            }
            case "timer": ok = true; log.push(`would wait ${n.data.minutes} min (simulated instantly)`); break;
            case "gateway": ok = true; break;
            case "action": ok = true; log.push(`fires ${ACTIONS[n.data.action]} → ${TARGETS[n.data.target]}${Object.keys(n.data.params).length ? ` ${JSON.stringify(Object.fromEntries(Object.entries(n.data.params).map(([k, v]) => [k, tmpl(v, ctx)])))}` : ""}`); break;
            case "parallel_action": ok = true; for (const a of n.data.actions) log.push(`fires ${ACTIONS[a.action]} → ${TARGETS[a.target]} (in parallel)`); break;
          }
        } catch (e) {
          error = (e as Error).message; errors.push(`#${id}: ${error}`); log.push(`error: ${error}`); ok = false;
          // Enrichment that is down must not stop the assessment: the variable is null and the path continues on the other signals.
          if (n.type === "api_call" || n.type === "ai" || n.type === "db_query") { put(n.data.output, null); if (n.type === "ai") put(`${n.data.output}_label`, null); ok = true; log.push(`continuing with ${n.data.output} = null`); }
        }
      }
    }
    reached.set(id, ok);
    if (ok) {
      const outs = w.edges.filter((e) => e.source === id), passes = (e: WfEdge) => own(by.get(e.target)!, ctx, svc, ev);
      const enabled = n.type === "gateway" && n.data.kind === "exclusive" ? outs.filter(passes).slice(0, 1) : n.type === "gateway" && n.data.kind === "inclusive" ? outs.filter(passes) : outs;
      for (const e of enabled) live.add(`${e.source}>${e.target}`);
      if (n.type === "gateway") log.push(`routes to ${enabled.map((e) => `#${e.target}`).join(", ") || "nothing"}`);
    }
    steps.push({ id, type: n.type, label: labelOf(n), reached: ok, log, ms: +(performance.now() - s0).toFixed(3), ...(error && { error }), ...(Object.keys(set).length && { set }) });
  }
  const fired = w.nodes.flatMap((n) => !reached.get(n.id) ? [] : n.type === "action" ? [{ id: n.id, action: n.data.action, target: n.data.target }] : n.type === "parallel_action" ? n.data.actions.map((a) => ({ id: n.id, ...a })) : []);
  const computed = Object.fromEntries(Object.entries(ctx).filter(([k]) => !has(FIELDS, k)));
  return { fired, steps, liveEdges: [...live], ms: +(performance.now() - t0).toFixed(3), errors, variables: computed };
}

// Performance over the stored run log (last 24 h for throughput).
export function metrics(runs: Run[], now = Date.now()) {
  const day = runs.filter((r) => now - Date.parse(r.at) < 864e5);
  return {
    runs: runs.length, runs24h: day.length, lastRun: runs.at(-1)?.at ?? null,
    successRate: runs.length ? runs.filter((r) => r.ok).length / runs.length : null,
    errorRate: runs.length ? runs.filter((r) => !r.ok).length / runs.length : null,
    avgMs: runs.length ? +(runs.reduce((n, r) => n + r.ms, 0) / runs.length).toFixed(3) : null,
    throughputPerHour: +(day.length / 24).toFixed(2),
    fired: runs.reduce((n, r) => n + r.fired.length, 0),
  };
}

const snap = (w: WorkflowBody, version: number, by: string, note: string): Version => ({ version, savedAt: new Date().toISOString(), savedBy: by, note, name: w.name, description: w.description, nodes: w.nodes, edges: w.edges });
export function newWorkflow(id: string, body: WorkflowBody, by: string, note = "Created"): Workflow {
  return { ...body, id, status: "Draft", version: 1, versions: [snap(body, 1, by, note)], updatedAt: new Date().toISOString(), updatedBy: by, runs: [] };
}
export function saveVersion(w: Workflow, body: WorkflowBody, by: string, note: string) {
  Object.assign(w, body, { version: w.version + 1, updatedAt: new Date().toISOString(), updatedBy: by });
  if (!body.description) delete w.description;
  w.versions.push(snap(body, w.version, by, note || `Version ${w.version}`));
  if (w.versions.length > 50) w.versions.splice(0, w.versions.length - 50); // keep the newest 50
}
export const deployed = (w: Workflow) => w.versions.find((v) => v.version === w.deployedVersion);

// Upgrade workflows stored before versioning (one-shot, idempotent).
export function migrate(w: Partial<Workflow> & WorkflowBody & { id: string; updatedAt: string; updatedBy: string }): Workflow {
  if (w.versions) return w as Workflow;
  const v = validateWorkflow(w), body = "workflow" in v ? v.workflow : w;
  return { ...newWorkflow(w.id, body, w.updatedBy, "Migrated"), updatedAt: w.updatedAt };
}

// Demo that uses every node type, all three gateway kinds and every action. Transfer trigger.
//  Trigger → Parallel split ─┬─ Rule (screen sharing) → Send alert (SOC)
//                            ├─ Condition (new device OR geo anomaly) → Timer 5 min → Notify user
//                            └─ Calculation → DB query → AML check → Inclusive ─┬─ Criteria (AML hit) → Flag for review (compliance)
//                                                                              └─ AI → API call → Scoring → Calculated field → Exclusive
//                                                                                   ├─ critical → Parallel action (block + alert + notify)
//                                                                                   ├─ high → Challenge customer (OTP)
//                                                                                   └─ medium → Flag for review
export const ALL_FEATURES = (): WorkflowBody => {
  const n = (id: string, type: string, data: object, x: number, y: number) => ({ id, type, data, position: { x, y } }) as WfNode;
  return {
    name: "All Features Showcase",
    description: "Uses every node type, all three gateway kinds and every action. Branches: rule hit → SOC alert; new device / geo → delayed customer notice; main path: formula, DB lookup, AML, AI, external API, scorecard, risk band → block / challenge / review.",
    nodes: [
      n("t", "trigger", { event: "transaction_created", source: "any" }, 0, 0),
      n("split", "gateway", { kind: "parallel" }, 0, 120),
      n("rule", "rule", { ruleId: "RULE-0001", output: "screen_rule" }, -520, 250),
      n("alertSoc", "action", { action: "send_alert", target: "soc", params: { severity: "high", text: "Screen-sharing rule hit on {{customer_name}} ({{amount}} IDR)" } }, -520, 380),
      n("dev", "condition", { mode: "OR", conditions: [{ field: "new_device", operator: "==", value: true }, { field: "geo_anomaly", operator: "==", value: true }] }, -260, 250),
      n("wait", "timer", { minutes: 5 }, -260, 380),
      n("notice", "action", { action: "notify_user", target: "customer", params: { channel: "sms", message: "New device / location used for a transfer of {{amount}} IDR. Not you? Call 14041." } }, -260, 510),
      n("ratio", "calculation", { expression: "round(amount / max(avg_daily_spend, 1))", output: "spend_ratio" }, 120, 250),
      n("hist", "db_query", { query: "beneficiary_alert_count", output: "ben_alerts" }, 120, 370),
      n("aml", "aml_check", { output: "aml", failOnHit: false }, 120, 490),
      n("incl", "gateway", { kind: "inclusive" }, 120, 610),
      n("amlHit", "criteria", { mode: "AND", criteria: [{ field: "aml_hit", operator: "==", value: true }] }, -140, 730),
      n("amlReview", "action", { action: "flag_for_review", target: "fraud_team", params: { queue: "compliance", reason: "AML: {{aml_reasons}}" } }, -140, 860),
      n("ai", "ai", { prompt: "Assess this transfer of {{amount}} IDR to {{beneficiary_name}} ({{spend_ratio}}x the usual daily spend). How likely is fraud?", output: "ai_risk" }, 380, 730),
      n("ext", "api_call", { method: "GET", url: "https://risk-bureau.example.com/v1/accounts/{{beneficiary_account}}/score", body: "", path: "data.score", output: "bureau_score" }, 380, 850),
      n("score", "scoring", { output: "score", base: 0, items: [
        { field: "spend_ratio", operator: ">=", value: 10, points: 25 }, { field: "new_beneficiary", operator: "==", value: true, points: 15 },
        { field: "ben_alerts", operator: ">", value: 0, points: 20 }, { field: "aml_score", operator: ">=", value: 50, points: 25 },
        { field: "ai_risk", operator: ">=", value: 70, points: 20 }, { field: "screen_sharing", operator: "==", value: true, points: 20 },
        { field: "vpn", operator: "==", value: true, points: 10 }, { field: "bureau_score", operator: ">=", value: 80, points: 15 },
      ] }, 380, 970),
      n("band", "calc_field", { input: "score", output: "risk_band", buckets: [{ max: 39, label: "low" }, { max: 59, label: "medium" }, { max: 79, label: "high" }], otherwise: "critical" }, 380, 1090),
      n("excl", "gateway", { kind: "exclusive" }, 380, 1210),
      n("isCrit", "criteria", { mode: "AND", criteria: [{ field: "risk_band", operator: "==", value: "critical" }] }, 120, 1340),
      n("isHigh", "criteria", { mode: "AND", criteria: [{ field: "risk_band", operator: "==", value: "high" }] }, 380, 1340),
      n("isMed", "criteria", { mode: "OR", criteria: [{ field: "risk_band", operator: "==", value: "medium" }, { field: "ai_risk_label", operator: "in", value: "HIGH, CRITICAL" }] }, 640, 1340),
      n("stop", "parallel_action", { actions: [{ action: "block_transaction", target: "core_banking" }, { action: "send_alert", target: "soc" }, { action: "notify_user", target: "customer" }] }, 120, 1470),
      n("otp", "action", { action: "challenge_customer", target: "customer", params: { reason: "score {{score}}" } }, 380, 1470),
      n("review", "action", { action: "flag_for_review", target: "fraud_team", params: { priority: "normal", reason: "score {{score}}, band {{risk_band}}" } }, 640, 1470),
    ],
    edges: [["t", "split"], ["split", "rule"], ["rule", "alertSoc"], ["split", "dev"], ["dev", "wait"], ["wait", "notice"], ["split", "ratio"], ["ratio", "hist"], ["hist", "aml"], ["aml", "incl"],
      ["incl", "amlHit"], ["amlHit", "amlReview"], ["incl", "ai"], ["ai", "ext"], ["ext", "score"], ["score", "band"], ["band", "excl"], ["excl", "isCrit"], ["excl", "isHigh"], ["excl", "isMed"],
      ["isCrit", "stop"], ["isHigh", "otp"], ["isMed", "review"]].map(([source, target]) => ({ source, target })),
  };
};

// The built-in scoring pipeline as an editable workflow. Set it to serve /api/transactions/score (Workflows → API).
//  Trigger → Baseline score → Active rules → AML → Exclusive: rule DECLINE → block · rule CHALLENGE → OTP ·
//  rule ALLOW / whitelist (no blacklist, no AML, not High) → allow · rule HOLD / blacklist / AML / Medium-High → review · else allow
export const DEFAULT_SCORING = (): WorkflowBody => {
  const n = (id: string, type: string, data: object, x: number, y: number) => ({ id, type, data, position: { x, y } }) as WfNode;
  const cr = (id: string, mode: "AND" | "OR", criteria: Crit[], x: number) => n(id, "criteria", { mode, criteria }, x, 600);
  return {
    name: "Default Transaction Scoring",
    description: "The built-in scoring pipeline as an editable workflow: baseline score, active rules, AML and watchlists decide block / challenge / review / allow.",
    nodes: [
      n("t", "trigger", { event: "transaction_created", source: "any" }, 0, 0),
      n("base", "baseline_score", structuredClone(BASELINE_DEFAULT), 0, 120),
      n("rules", "rule_engine", { output: "rules" }, 0, 240),
      n("aml", "aml_check", { output: "aml", failOnHit: false }, 0, 360),
      n("pick", "gateway", { kind: "exclusive" }, 0, 480),
      cr("isDecline", "AND", [{ field: "rules_action", operator: "==", value: "DECLINE" }], -600),
      cr("isChallenge", "AND", [{ field: "rules_action", operator: "==", value: "CHALLENGE" }], -360),
      cr("allowRule", "AND", [{ field: "rules_action", operator: "==", value: "ALLOW" }, { field: "on_blacklist", operator: "==", value: false }, { field: "aml_hit", operator: "==", value: false }, { field: "baseline_level", operator: "!=", value: "HIGH" }], -120),
      cr("allowWhite", "AND", [{ field: "on_whitelist", operator: "==", value: true }, { field: "on_blacklist", operator: "==", value: false }, { field: "aml_hit", operator: "==", value: false }, { field: "baseline_level", operator: "!=", value: "HIGH" }], 120),
      cr("isReview", "OR", [{ field: "rules_action", operator: "==", value: "HOLD" }, { field: "on_blacklist", operator: "==", value: true }, { field: "aml_hit", operator: "==", value: true }, { field: "baseline_level", operator: "in", value: "MEDIUM, HIGH" }], 360),
      n("block", "action", { action: "block_transaction", target: "core_banking", params: { reason: "{{rules_names}}" } }, -600, 730),
      n("otp", "action", { action: "challenge_customer", target: "customer", params: { reason: "{{rules_names}}" } }, -360, 730),
      n("review", "action", { action: "flag_for_review", target: "fraud_team", params: { reason: "score {{baseline_score}} {{baseline_level}} · {{rules_names}}" } }, 360, 730),
    ],
    edges: [["t", "base"], ["base", "rules"], ["rules", "aml"], ["aml", "pick"], ["pick", "isDecline"], ["pick", "isChallenge"], ["pick", "allowRule"], ["pick", "allowWhite"], ["pick", "isReview"],
      ["isDecline", "block"], ["isChallenge", "otp"], ["isReview", "review"]].map(([source, target]) => ({ source, target })),
  };
};

// The built-in login and account-update scoring as editable workflows. Set them to serve /api/events/login and /api/events/account-update.
export const DEFAULT_EVENT = (kind: "login_attempt" | "account_update"): WorkflowBody => {
  const n = (id: string, type: string, data: object, x: number, y: number) => ({ id, type, data, position: { x, y } }) as WfNode;
  const login = kind === "login_attempt";
  return {
    name: login ? "Default Login Scoring" : "Default Account Update Scoring",
    description: login ? "The built-in login risk score as an editable workflow: DENY → block + SOC alert, CHALLENGE → step-up OTP, otherwise allow."
      : "The built-in account-change risk score as an editable workflow: DENY → block + SOC alert + customer notice, CHALLENGE → OTP, allowed sensitive changes still notify the customer.",
    nodes: [
      n("t", "trigger", { event: kind, source: "any" }, 0, 0),
      n("score", "event_score", structuredClone(EVENT_DEFAULT), 0, 120),
      n("pick", "gateway", { kind: "exclusive" }, 0, 240),
      n("deny", "criteria", { mode: "AND", criteria: [{ field: "event_decision", operator: "==", value: "DENY" }] }, -300, 360),
      n("chal", "criteria", { mode: "AND", criteria: [{ field: "event_decision", operator: "==", value: "CHALLENGE" }] }, 0, 360),
      n("block", "parallel_action", { actions: [{ action: "block_transaction", target: "core_banking" }, { action: "send_alert", target: "soc" }, ...(login ? [] : [{ action: "notify_user", target: "customer" }])] }, -300, 490),
      login ? n("otp", "action", { action: "challenge_customer", target: "customer", params: { reason: "{{event_reasons}}" } }, 0, 490)
        : n("otp", "parallel_action", { actions: [{ action: "challenge_customer", target: "customer" }, { action: "notify_user", target: "customer" }] }, 0, 490), // a changed phone / email is always told to the customer
      ...(login ? [] : [
        n("sens", "criteria", { mode: "AND", criteria: [{ field: "change_type", operator: "in", value: "phone, email, password, pin" }] }, 300, 360),
        n("tell", "action", { action: "notify_user", target: "customer", params: { channel: "sms", message: "Your {{change_type}} was changed. Not you? Call 14041." } }, 300, 490),
      ]),
    ],
    edges: [["t", "score"], ["score", "pick"], ["pick", "deny"], ["pick", "chal"], ...(login ? [] : [["pick", "sens"], ["sens", "tell"]]), ["deny", "block"], ["chal", "otp"]].map(([source, target]) => ({ source, target })),
  };
};

export const SEED_WORKFLOWS = (): Workflow[] => {
  const w = newWorkflow("wf_001", {
    name: "High Amount Check", description: "Scores large transfers, calls the screen-sharing rule and asks AI; risky ones are flagged and the customer is notified.",
    nodes: [
      { id: "1", type: "trigger", data: { event: "transaction_created", source: "any" }, position: { x: 0, y: 0 } },
      { id: "2", type: "calculation", data: { expression: "round(amount / max(avg_daily_spend, 1))", output: "spend_ratio" }, position: { x: 0, y: 120 } },
      { id: "3", type: "db_query", data: { query: "beneficiary_alert_count", output: "ben_alerts" }, position: { x: 0, y: 240 } },
      { id: "4", type: "scoring", data: { output: "score", base: 0, items: [
        { field: "spend_ratio", operator: ">=", value: 10, points: 30 }, { field: "new_beneficiary", operator: "==", value: true, points: 15 },
        { field: "new_device", operator: "==", value: true, points: 15 }, { field: "ben_alerts", operator: ">", value: 0, points: 20 }, { field: "vpn", operator: "==", value: true, points: 10 },
      ] }, position: { x: 0, y: 360 } },
      { id: "5", type: "calc_field", data: { input: "score", output: "risk_band", buckets: [{ max: 29, label: "low" }, { max: 59, label: "medium" }], otherwise: "high" }, position: { x: 0, y: 480 } },
      { id: "6", type: "gateway", data: { kind: "exclusive" }, position: { x: 0, y: 600 } },
      { id: "7", type: "criteria", data: { mode: "AND", criteria: [{ field: "risk_band", operator: "==", value: "high" }] }, position: { x: -220, y: 720 } },
      { id: "8", type: "criteria", data: { mode: "AND", criteria: [{ field: "risk_band", operator: "==", value: "medium" }] }, position: { x: 220, y: 720 } },
      { id: "9", type: "parallel_action", data: { actions: [{ action: "flag_for_review", target: "fraud_team" }, { action: "notify_user", target: "customer" }, { action: "send_alert", target: "soc" }] }, position: { x: -220, y: 850 } },
      { id: "10", type: "action", data: { action: "flag_for_review", target: "fraud_team", params: { priority: "normal", reason: "score {{score}}" } }, position: { x: 220, y: 850 } },
    ],
    edges: [{ source: "1", target: "2" }, { source: "2", target: "3" }, { source: "3", target: "4" }, { source: "4", target: "5" }, { source: "5", target: "6" }, { source: "6", target: "7" }, { source: "6", target: "8" }, { source: "7", target: "9" }, { source: "8", target: "10" }],
  }, "system", "Seed");
  const v = validateWorkflow(ALL_FEATURES()), all = newWorkflow("wf_002", "workflow" in v ? v.workflow : ALL_FEATURES(), "system", "Seed: all features");
  const dv = validateWorkflow(DEFAULT_SCORING()), sc = newWorkflow("wf_003", "workflow" in dv ? dv.workflow : DEFAULT_SCORING(), "system", "Seed: built-in scoring as a workflow");
  const ev = (id: string, k: "login_attempt" | "account_update") => { const v = validateWorkflow(DEFAULT_EVENT(k)), x = newWorkflow(id, "workflow" in v ? v.workflow : DEFAULT_EVENT(k), "system", "Seed: built-in event scoring as a workflow"); return { ...x, status: "Active" as const, deployedVersion: 1, deployedAt: x.updatedAt }; };
  return [{ ...w, status: "Active", deployedVersion: 1, deployedAt: w.updatedAt }, { ...sc, status: "Active", deployedVersion: 1, deployedAt: sc.updatedAt, role: "transaction_created" }, { ...ev("wf_004", "login_attempt"), role: "login_attempt" }, { ...ev("wf_005", "account_update"), role: "account_update" }, { ...all, status: "Active", deployedVersion: 1, deployedAt: all.updatedAt, endpoint: { slug: "all-features-demo", enabled: false, publishedAt: all.updatedAt, publishedBy: "system", calls: 0 } }];
};
