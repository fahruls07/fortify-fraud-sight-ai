import { Type } from "@google/genai";
import { generate, geminiConfigured } from "./copilot/gemini";
import { networkFor } from "./network";
import { config } from "./settings.ts";
import { getStore } from "./store";
import { fill, type Ctx, type Services } from "./workflows.ts";
import { amlScreen } from "./intel.ts";

const DAY = 864e5;
const num = (v: unknown) => (typeof v === "number" ? v : 0);

// Read-only lookups for Database query nodes. Named queries only: no free-form SQL reaches the data.
function db(query: Parameters<Services["db"]>[0], ctx: Ctx): number {
  const s = getStore(), cid = String(ctx.customer_id ?? ""), ben = String(ctx.beneficiary_account ?? ""), now = Date.now();
  const txs = s.transactions.filter((t) => t.customerId === cid);
  const since = (ms: number) => txs.filter((t) => now - Date.parse(t.createdAt) < ms);
  switch (query) {
    case "customer_tx_count_24h": return since(DAY).length;
    case "customer_tx_amount_24h": return since(DAY).reduce((n, t) => n + t.amount, 0);
    case "customer_avg_amount_30d": { const l = since(30 * DAY); return l.length ? Math.round(l.reduce((n, t) => n + t.amount, 0) / l.length) : 0; }
    case "customer_open_alerts": return s.alerts.filter((a) => a.customerId === cid && a.status !== "Decided").length;
    case "customer_fraud_count": return s.decisions.filter((d) => d.label === "FRAUD" && s.alerts.find((a) => a.id === d.alertId)?.customerId === cid).length;
    case "beneficiary_alert_count": return s.alerts.filter((a) => s.transactions.find((t) => t.id === a.transactionId)?.beneficiary.accountId === ben).length;
    case "beneficiary_shared_devices": return networkFor(s, ben).sharedDeviceWith;
  }
}

// API call nodes may only reach URLs under an endpoint listed in Settings → Integration (allowlist), with a 4 s timeout.
async function api(n: Parameters<Services["api"]>[0], ctx: Ctx) {
  const url = fill(n.url, ctx), allowed = config().integration.endpoints.some((e) => { try { const a = new URL(e.url), b = new URL(url); return a.origin === b.origin && b.pathname.startsWith(a.pathname.replace(/\/$/, "")); } catch { return false; } });
  if (!allowed) throw new Error(`URL not allowed. Add its base URL under Settings → Integration → External API endpoints.`);
  const r = await fetch(url, { method: n.method, redirect: "manual", signal: AbortSignal.timeout(4000), headers: { Accept: "application/json", ...(n.method === "POST" && { "Content-Type": "application/json" }) }, body: n.method === "POST" ? fill(n.body, ctx) : undefined });
  if (!r.ok) throw new Error(`API answered HTTP ${r.status}`);
  const text = (await r.text()).slice(0, 100_000);
  try { return JSON.parse(text); } catch { return text.slice(0, 200); }
}

// AI node: Gemini returns { score 0–100, label, reason }. Without Gemini (or on error/timeout) a transparent heuristic answers instead.
const SCHEMA = { type: Type.OBJECT, required: ["score", "label", "reason"], properties: { score: { type: Type.NUMBER }, label: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }, reason: { type: Type.STRING } } };
function heuristic(ctx: Ctx) {
  const parts: [boolean, number, string][] = [[num(ctx.amount) > 10 * Math.max(num(ctx.avg_daily_spend), 1), 25, "amount ≫ usual"], [!!ctx.screen_sharing, 25, "screen sharing"], [!!ctx.new_beneficiary, 10, "new beneficiary"], [!!ctx.vpn, 10, "VPN"], [!!ctx.new_device, 10, "new device"], [num(ctx.shared_device_with) > 0, 15, "mule-linked beneficiary"], [num(ctx.copy_paste) > 2, 5, "pasted account number"]];
  const hits = parts.filter(([h]) => h), score = Math.min(100, hits.reduce((n, [, p]) => n + p, 0));
  return { score, label: score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW", reason: hits.map(([, , r]) => r).join(", ") || "no risk signals" };
}
async function ai(prompt: string, ctx: Ctx) {
  if (!geminiConfigured()) return { ...heuristic(ctx), source: "heuristic (Gemini not configured)" };
  try {
    const { text } = await generate(`${prompt}\n\nTransaction context (JSON):\n${JSON.stringify(ctx)}\n\nReturn a fraud risk score 0-100, a label and a one-sentence reason.`, AbortSignal.timeout(8000),
      { systemInstruction: "You are a bank fraud analyst. Use only the given context. Answer in English.", responseSchema: SCHEMA });
    const j = JSON.parse(text);
    return { score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))), label: String(j.label), reason: String(j.reason).slice(0, 200), source: "Gemini" };
  } catch (e) { return { ...heuristic(ctx), source: `heuristic (Gemini failed: ${(e as Error).message.slice(0, 60)})` }; }
}

const aml = (ctx: Ctx) => amlScreen(getStore(), { customerName: String(ctx.customer_name ?? ""), beneficiaryName: String(ctx.beneficiary_name ?? ""), customerId: String(ctx.customer_id ?? ""), ipCountry: ctx.ip_country ? String(ctx.ip_country) : null, amount: typeof ctx.amount === "number" ? ctx.amount : undefined });
export const services = (): Services => ({ rule: (id) => getStore().rules.find((r) => r.id === id), rules: () => getStore().rules, db, api, ai, aml });
