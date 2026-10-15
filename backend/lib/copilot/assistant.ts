import { generate, geminiConfigured } from "./gemini.ts";
import { overview } from "../overview.ts";
import { idr } from "../format.ts";
import { metrics } from "../workflows.ts";
import type { State } from "../store";

// Dashboard assistant: answers questions about the live console data. Read-only: it never changes anything.
export type Msg = { role: "user" | "assistant"; content: string };

function facts(s: State) {
  const d = overview(s, { range: "24h" }), w = overview(s, { range: "7d" });
  const open = s.alerts.filter((a) => a.status !== "Decided");
  return {
    last24h: { transactions: d.totalTransactions, flaggedAlerts: d.flaggedAlerts, confirmedFraud: d.fraudDetected, fraudAmount: d.fraudAmount, falsePositiveRate: d.falsePositiveRate, averageScore: d.averageScore, severity: d.severity },
    last7d: { flaggedAlerts: w.flaggedAlerts, confirmedFraud: w.fraudDetected, severity: w.severity },
    openAlerts: open.length, openHighOrCritical: d.openHigh,
    latestAlerts: d.latest.slice(0, 8).map((a) => ({ id: a.id, customer: a.customerName, amount: a.amount, severity: a.severity, status: a.status, createdAt: a.createdAt })),
    rules: { active: s.rules.filter((r) => r.status === "Active").map((r) => r.name), inactive: s.rules.filter((r) => r.status !== "Active").length },
    workflows: s.workflows.map((x) => ({ name: x.name, status: x.status, ...(({ runs24h, successRate }) => ({ runs24h, successRate }))(metrics(x.runs)) })),
  };
}

const SYSTEM = `You are the AI assistant on the Command Center of a bank fraud console. Answer the analyst's question using ONLY the JSON facts provided.
Be concise (max ~6 short lines or a short list), in the user's language (English or Indonesian). Amounts are IDR; format like "Rp 25.000.000".
If the facts do not contain the answer, say so and suggest where in the console to look (Alerts, Fraud Report, Rules, Workflows). Never invent numbers. You cannot take actions.`;

function offline(s: State, q: string) {
  const f = facts(s), t = q.toLowerCase(), pct = (v: number | null) => (v === null ? "n/a (nothing decided yet)" : `${(v * 100).toFixed(1)}%`);
  if (/fraud|penipuan/.test(t) && /(rate|persen|percent|false|positif)/.test(t)) return `False-positive rate (24 h): ${pct(f.last24h.falsePositiveRate)}. Confirmed fraud: ${f.last24h.confirmedFraud} (${idr(f.last24h.fraudAmount)}).`;
  if (/(latest|terbaru|recent|terakhir|newest)/.test(t)) return f.latestAlerts.length ? `Latest alerts:\n${f.latestAlerts.slice(0, 5).map((a) => `• ${a.id} ${a.customer} ${idr(a.amount)} · ${a.severity} · ${a.status}`).join("\n")}` : "No alerts in the last 24 hours.";
  if (/(high|critical|tinggi|kritis|urgent)/.test(t)) return `${f.openHighOrCritical} high/critical alerts are still open. Severity in the last 24 h: ${Object.entries(f.last24h.severity).map(([k, v]) => `${k} ${v}`).join(", ")}.`;
  if (/(rule|aturan)/.test(t)) return `${f.rules.active.length} active rules: ${f.rules.active.join("; ") || "none"}. ${f.rules.inactive} inactive.`;
  if (/(workflow|alur)/.test(t)) return f.workflows.map((w) => `• ${w.name} (${w.status}) · ${w.runs24h} runs / 24 h · success ${pct(w.successRate)}`).join("\n") || "No workflows.";
  if (/(transaksi|transaction|volume)/.test(t)) return `${f.last24h.transactions.toLocaleString("en-US")} transactions in the last 24 h; ${f.last24h.flaggedAlerts} were flagged (average risk score ${f.last24h.averageScore ?? "n/a"}).`;
  return `Summary (24 h): ${f.last24h.transactions} transactions, ${f.last24h.flaggedAlerts} flagged, ${f.last24h.confirmedFraud} confirmed fraud, ${f.openAlerts} alerts open (${f.openHighOrCritical} high/critical).\nAsk about latest alerts, high-risk alerts, fraud rate, rules or workflows.`;
}

export async function assistant(s: State, messages: Msg[]) {
  const last = messages.at(-1)!.content;
  if (s.fallbackOnly || !geminiConfigured()) return { reply: offline(s, last), source: "offline" as const };
  try {
    const history = messages.slice(-10).map((m) => `${m.role === "user" ? "Analyst" : "Assistant"}: ${m.content}`).join("\n");
    const r = await generate(`Facts (JSON, live):\n${JSON.stringify(facts(s))}\n\nConversation:\n${history}\n\nAnswer the analyst's last message.`, AbortSignal.timeout(15000), { systemInstruction: SYSTEM, text: true });
    return { reply: r.text.trim() || offline(s, last), source: "gemini" as const };
  } catch (e) { return { reply: offline(s, last), source: "offline" as const, note: `Gemini failed: ${(e as Error).message.slice(0, 80)}` }; }
}
