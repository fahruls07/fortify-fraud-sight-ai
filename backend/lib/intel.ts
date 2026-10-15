import type { State } from "./store";

// Risk intelligence: watchlists (black / white), AML screening (sanctions, PEP, internal lists + behaviour) and non-transfer events.
export const LIST_TYPES = { ACCOUNT: "Account number", BENEFICIARY: "Beneficiary name", DEVICE: "Device ID", IP: "IP address / CIDR" } as const;
export type ListType = keyof typeof LIST_TYPES;
export interface ListEntry { id: string; list: "BLACK" | "WHITE"; type: ListType; value: string; reason: string; expiresAt: string | null; createdBy: string; createdAt: string; hits: number; lastHitAt?: string }
export const AML_TYPES = { SANCTION: "Sanctions list", PEP: "Politically exposed person", INTERNAL: "Internal watch" } as const;
export interface AmlEntry { id: string; name: string; type: keyof typeof AML_TYPES; country: string; source: string; notes: string; createdBy: string; createdAt: string }
export interface Hit { kind: "BLACKLIST" | "WHITELIST" | "AML" | "THRESHOLD" | "RULE"; ref: string; type: string; value: string; detail: string }
export interface RiskEvent {
  id: string; type: "login_attempt" | "account_update"; at: string; customerId: string; sessionId: string | null; deviceId: string | null; ip: string | null; ipCountry: string | null;
  success: boolean | null; failedAttempts: number; change: string | null; score: number; decision: "ALLOW" | "CHALLENGE" | "DENY"; reasons: string[]; hits: Hit[];
}

const norm = (t: ListType, v: string) => (t === "BENEFICIARY" ? nameKey(v) : t === "IP" ? v.trim() : v.trim().toUpperCase());
const ip4 = (s: string) => { const p = s.split("."); return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && +x <= 255) ? p.reduce((n, x) => n * 256 + +x, 0) : null; };
function ipMatch(rule: string, ip: string) {
  const [base, bits] = rule.split("/"), a = ip4(base), b = ip4(ip);
  if (a === null || b === null) return rule === ip;
  if (bits === undefined) return a === b;
  const n = Number(bits), mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}
export function validateListEntry(b: Record<string, unknown>): Omit<ListEntry, "id" | "createdBy" | "createdAt" | "hits"> | string {
  if (b.list !== "BLACK" && b.list !== "WHITE") return "List must be BLACK or WHITE.";
  if (typeof b.type !== "string" || !(b.type in LIST_TYPES)) return `Type must be one of ${Object.keys(LIST_TYPES).join(", ")}.`;
  const value = typeof b.value === "string" ? b.value.trim() : "";
  if (!value || value.length > 120) return "Value is required (max 120 characters).";
  if (b.type === "IP") { const [base, bits] = value.split("/"); if (ip4(base) === null || (bits !== undefined && !(/^\d+$/.test(bits) && +bits <= 32))) return "IP must be IPv4 like 10.1.2.3 or a CIDR like 10.1.0.0/16."; }
  const exp = typeof b.expiresAt === "string" && b.expiresAt ? new Date(b.expiresAt) : null;
  if (exp && Number.isNaN(+exp)) return "Expiry date is invalid.";
  return { list: b.list, type: b.type as ListType, value, reason: typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "", expiresAt: exp ? exp.toISOString() : null };
}

export interface Subject { accounts: string[]; beneficiaryName?: string; deviceId?: string | null; ip?: string | null }
// Which active list entries match this subject. Expired entries are ignored.
export function listHits(s: State, sub: Subject, now = Date.now()): { black: ListEntry[]; white: ListEntry[] } {
  const live = s.watchlist.filter((e) => !e.expiresAt || Date.parse(e.expiresAt) > now);
  const hit = (e: ListEntry) =>
    e.type === "ACCOUNT" ? sub.accounts.some((a) => norm("ACCOUNT", a) === norm("ACCOUNT", e.value))
    : e.type === "BENEFICIARY" ? !!sub.beneficiaryName && nameKey(sub.beneficiaryName) === norm("BENEFICIARY", e.value)
    : e.type === "DEVICE" ? !!sub.deviceId && norm("DEVICE", sub.deviceId) === norm("DEVICE", e.value)
    : !!sub.ip && ipMatch(e.value, sub.ip);
  const m = live.filter(hit), at = new Date(now).toISOString();
  for (const e of m) { e.hits++; e.lastHitAt = at; }
  return { black: m.filter((e) => e.list === "BLACK"), white: m.filter((e) => e.list === "WHITE") };
}

// ---- AML ----
const TITLES = /\b(h|hj|haji|dr|drs|ir|prof|mr|mrs|ms|bapak|ibu|pak|bu|sdr|tn|ny|s\.?h|s\.?e|s\.?kom|m\.?m)\b\.?/g;
export const nameKey = (n: string) => n.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(TITLES, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return d[b.length];
}
// 0..1 similarity on title-stripped, token-sorted names (handles word order, titles, accents, small typos).
export function nameScore(a: string, b: string) { const x = nameKey(a), y = nameKey(b); if (!x || !y) return 0; return 1 - lev(x, y) / Math.max(x.length, y.length); }
export const MATCH_AT = 0.86;
export const HIGH_RISK_COUNTRIES = ["KP", "IR", "MM", "RU", "SY", "AF", "YE"]; // shortcut: static FATF-style list; source it from compliance before production.
const STRUCTURING = { threshold: 100_000_000, band: 0.9, count: 3, windowMs: 864e5 }; // ≥3 transfers in 24 h each 90–100% of 100 juta

export interface AmlResult { hit: boolean; score: number; reasons: string[]; matches: { id: string; name: string; type: string; score: number; who: "customer" | "beneficiary" }[] }
export function amlScreen(s: State, p: { customerName?: string; beneficiaryName?: string; customerId?: string; ipCountry?: string | null; amount?: number; at?: string }): AmlResult {
  const matches: AmlResult["matches"] = [], reasons: string[] = [];
  for (const e of s.amlList) for (const [who, n] of [["customer", p.customerName], ["beneficiary", p.beneficiaryName]] as const) {
    if (!n) continue;
    const sc = nameScore(n, e.name);
    if (sc >= MATCH_AT) matches.push({ id: e.id, name: e.name, type: e.type, score: +sc.toFixed(2), who });
  }
  for (const m of matches) reasons.push(`${m.who} name matches ${AML_TYPES[m.type as keyof typeof AML_TYPES]} entry "${m.name}" (${Math.round(m.score * 100)}%)`);
  let score = matches.reduce((n, m) => n + (m.type === "SANCTION" ? 70 : m.type === "PEP" ? 35 : 25), 0);
  if (p.ipCountry && HIGH_RISK_COUNTRIES.includes(p.ipCountry)) { score += 20; reasons.push(`session from high-risk country ${p.ipCountry}`); }
  if (p.customerId) {
    const now = p.at ? Date.parse(p.at) : Date.now(), lo = STRUCTURING.threshold * STRUCTURING.band;
    const near = s.transactions.filter((t) => t.customerId === p.customerId && now - Date.parse(t.createdAt) < STRUCTURING.windowMs && t.amount >= lo && t.amount < STRUCTURING.threshold).length + (p.amount && p.amount >= lo && p.amount < STRUCTURING.threshold ? 1 : 0);
    if (near >= STRUCTURING.count) { score += 30; reasons.push(`possible structuring: ${near} transfers just under Rp ${STRUCTURING.threshold.toLocaleString("id-ID")} in 24 h`); }
  }
  score = Math.min(100, score);
  return { hit: score >= 50 || matches.some((m) => m.type === "SANCTION"), score, reasons, matches };
}
export function validateAml(b: Record<string, unknown>): Omit<AmlEntry, "id" | "createdBy" | "createdAt"> | string {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 3 || name.length > 120) return "Name is required (3–120 characters).";
  if (typeof b.type !== "string" || !(b.type in AML_TYPES)) return "Type must be SANCTION, PEP or INTERNAL.";
  const country = typeof b.country === "string" ? b.country.trim().toUpperCase() : "";
  if (country && !/^[A-Z]{2}$/.test(country)) return "Country must be a 2-letter ISO code (or empty).";
  return { name, type: b.type as AmlEntry["type"], country, source: typeof b.source === "string" ? b.source.trim().slice(0, 80) : "", notes: typeof b.notes === "string" ? b.notes.trim().slice(0, 300) : "" };
}

// ---- Login / account-update events ----
const SENSITIVE = ["phone", "email", "password", "pin", "device", "beneficiary_add", "limit"];
export function scoreEvent(s: State, e: Omit<RiskEvent, "id" | "at" | "score" | "decision" | "reasons" | "hits">) {
  const c = s.customers.find((x) => x.id === e.customerId)!, reasons: string[] = [];
  let score = 0;
  const lists = listHits(s, { accounts: [c.accountId], deviceId: e.deviceId, ip: e.ip });
  const hits: Hit[] = [...lists.black.map((x): Hit => ({ kind: "BLACKLIST", ref: x.id, type: x.type, value: x.value, detail: x.reason })), ...lists.white.map((x): Hit => ({ kind: "WHITELIST", ref: x.id, type: x.type, value: x.value, detail: x.reason }))];
  if (lists.black.length) { score += 60; reasons.push(`blacklisted ${lists.black.map((x) => LIST_TYPES[x.type].toLowerCase()).join(", ")}`); }
  if (e.deviceId && e.deviceId !== c.usualDevice) { score += 25; reasons.push("unrecognised device"); }
  if (e.ipCountry && e.ipCountry !== c.homeCountry) { score += 20; reasons.push(`foreign IP (${e.ipCountry})`); }
  if (e.ipCountry && HIGH_RISK_COUNTRIES.includes(e.ipCountry)) { score += 15; reasons.push("high-risk country"); }
  if (e.type === "login_attempt") {
    if (e.failedAttempts) { score += Math.min(40, e.failedAttempts * 10); reasons.push(`${e.failedAttempts} failed attempt(s)`); }
    if (e.success === false) score += 5;
  } else if (e.change && SENSITIVE.includes(e.change)) { score += 30; reasons.push(`sensitive change: ${e.change}`); }
  const recent = s.events.filter((x) => x.customerId === e.customerId && Date.now() - Date.parse(x.at) < 3600e3);
  if (e.type === "account_update" && recent.some((x) => x.type === "login_attempt" && x.reasons.includes("unrecognised device"))) { score += 20; reasons.push("change right after a login from a new device"); }
  if (lists.white.length && !lists.black.length) { score = Math.max(0, score - 30); reasons.push("whitelisted"); }
  score = Math.min(100, score);
  return { score, decision: (score >= 60 ? "DENY" : score >= 30 ? "CHALLENGE" : "ALLOW") as RiskEvent["decision"], reasons, hits };
}
