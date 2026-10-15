import type { Alert } from "./types";
import type { State } from "./store";
import { toRow } from "./alerts.ts";

export const RANGES = { "24h": { ms: 24 * 3600e3, buckets: 24, step: 3600e3 }, "7d": { ms: 7 * 864e5, buckets: 7, step: 864e5 }, "30d": { ms: 30 * 864e5, buckets: 30, step: 864e5 } } as const;
export type Range = keyof typeof RANGES;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const STATUSES = ["New", "Investigating", "Decided"] as const;
export interface OverviewFilter { range: Range; severity?: string | null; status?: string | null }

// Severity = AI level once the Assistant has run (only it can say CRITICAL), else the baseline level.
export const severity = (a: Alert) => a.aiLevel ?? a.baselineLevel;

// Command Center numbers for one time range; severity/status filters narrow the alert-based figures.
export function overview(s: State, f: OverviewFilter, now = Date.now()) {
  const R = RANGES[f.range], since = now - R.ms;
  const inRange = (iso: string) => { const t = new Date(iso).getTime(); return t >= since && t <= now; };
  const alerts = s.alerts.filter((a) => inRange(a.createdAt) && (!f.severity || severity(a) === f.severity) && (!f.status || a.status === f.status));
  const ids = new Set(alerts.map((a) => a.id));
  const ds = s.decisions.filter((d) => ids.has(d.alertId));
  const fraud = ds.filter((d) => d.label === "FRAUD"), fp = ds.filter((d) => d.label === "NOT_FRAUD");
  const txs = s.transactions.filter((t) => inRange(t.createdAt));

  // Buckets end at the current hour/day boundary so labels are stable; oldest first.
  const end = f.range === "24h" ? new Date(now).setMinutes(0, 0, 0) + R.step : now;
  const bucket = (iso: string) => R.buckets - 1 - Math.floor((end - new Date(iso).getTime()) / R.step);
  const trend = Array.from({ length: R.buckets }, (_, i) => ({ start: new Date(end - (R.buckets - i) * R.step).toISOString(), alerts: 0, fraud: 0 }));
  for (const a of alerts) { const i = bucket(a.createdAt); if (i >= 0 && i < R.buckets) trend[i].alerts++; }
  for (const d of fraud) { const a = alerts.find((x) => x.id === d.alertId)!, i = bucket(a.createdAt); if (i >= 0 && i < R.buckets) trend[i].fraud++; }

  return {
    totalTransactions: txs.length,
    flaggedAlerts: alerts.length,
    fraudDetected: fraud.length,
    fraudAmount: fraud.reduce((n, d) => n + d.amount, 0),
    decided: ds.length,
    falsePositiveRate: ds.length ? fp.length / ds.length : null, // analyst said NOT_FRAUD, share of decided alerts
    averageScore: alerts.length ? Math.round(alerts.reduce((n, a) => n + a.baselineScore, 0) / alerts.length) : null,
    severity: Object.fromEntries(SEVERITIES.map((l) => [l, alerts.filter((a) => severity(a) === l).length])) as Record<(typeof SEVERITIES)[number], number>,
    trend,
    latest: [...alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map((a) => ({ ...toRow(s, a), severity: severity(a) })),
    openHigh: s.alerts.filter((a) => a.status !== "Decided" && ["HIGH", "CRITICAL"].includes(severity(a))).length,
    aiMode: s.fallbackOnly ? "fallback" : "live",
  };
}
export type Overview = ReturnType<typeof overview>;
