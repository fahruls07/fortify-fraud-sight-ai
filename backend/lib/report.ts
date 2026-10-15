import type { Alert } from "./types";
import type { State } from "./store";
import { toRow } from "./alerts.ts";
import { ruleNameOf } from "./alertview.ts";
import { auditRows, ojkRows, strRows } from "./regulatory.ts";

type Row = Record<string, string | number>;
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" });
const jkt = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD, compares with <input type=date>

export const REPORTS = {
  alerts: "Alert Detail",
  decisions: "Analyst Decisions",
  held: "Held / Declined Transactions",
  customers: "Summary by Customer",
  risk: "Summary by Risk Level",
  str: "LTKM / STR candidates (PPATK)",
  ojk: "Fraud summary (OJK)",
  audit: "Audit log",
} as const;
export type ReportType = keyof typeof REPORTS;

export interface ReportFilter { from?: string | null; to?: string | null; alertId?: string | null; severity?: string | null; rule?: string | null; q?: string | null }

const CATEGORY: Record<string, string> = {
  SOCIAL_ENGINEERING_SCREEN_SHARING: "Social engineering", MULE_ACCOUNT: "Mule account", ACCOUNT_TAKEOVER: "Account takeover",
  PHISHING_CREDENTIAL_THEFT: "Phishing", AUTHORISED_PUSH_PAYMENT: "Authorised push payment", NONE: "Legitimate / none",
};
// Fraud category = typology from the latest finished Assistant investigation of the alert.
export function categoryOf(s: State, a: Alert) {
  const inv = Object.values(s.investigations ?? {}).filter((i) => i.alertId === a.id && i.report).sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0];
  return inv ? CATEGORY[inv.report!.typology] ?? inv.report!.typology : "Not investigated";
}
export const severityOf = (a: Alert) => a.aiLevel ?? a.baselineLevel;

// Period (Jakarta date of alert creation, inclusive), alert-ID substring, severity and rule apply to every sub-report.
export function filterAlerts(s: State, f: ReportFilter) {
  const id = f.alertId?.trim().toUpperCase();
  return s.alerts.filter((a) => { const d = jkt(a.createdAt); return (!f.from || d >= f.from) && (!f.to || d <= f.to) && (!id || a.id.toUpperCase().includes(id)) && (!f.severity || severityOf(a) === f.severity) && (!f.rule || ruleNameOf(s, a) === f.rule); })
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

function detail(s: State, a: Alert): Row {
  const r = toRow(s, a), d = s.decisions.find((x) => x.alertId === a.id), tx = s.transactions.find((t) => t.id === a.transactionId)!;
  return {
    "Alert ID": a.id, "Created": dt(a.createdAt), "Customer": r.customerName, "Account": r.maskedAccount, "Amount (IDR)": r.amount,
    "Beneficiary": `${tx.beneficiary.bankName} ${r.beneficiary.masked}`, "New Beneficiary": tx.beneficiary.isNew ? "Yes" : "No", "Channel": tx.channel, "Rule": ruleNameOf(s, a), "Category": categoryOf(s, a), "Score": a.baselineScore, "Risk": a.baselineLevel, "AI Risk": a.aiLevel ?? "",
    "Alert Status": a.status, "Transaction Status": tx.status, "Assigned To": a.assignedTo || "Unassigned", "Decision": d?.action ?? "", "Outcome": d?.label ?? "",
  };
}

function summary(alerts: Alert[], s: State, key: (a: Alert) => string, label: string): Row[] {
  const m = new Map<string, Alert[]>();
  for (const a of alerts) m.set(key(a), [...(m.get(key(a)) ?? []), a]);
  return [...m].map(([k, as]) => {
    const ds = as.map((a) => s.decisions.find((d) => d.alertId === a.id)).filter((d) => !!d);
    return {
      [label]: k, "Alerts": as.length, "High Risk": as.filter((a) => a.baselineLevel === "HIGH").length, "Open": as.filter((a) => a.status !== "Decided").length, "Avg Score": Math.round(as.reduce((n, a) => n + a.baselineScore, 0) / as.length),
      "Total Amount (IDR)": as.reduce((n, a) => n + s.transactions.find((t) => t.id === a.transactionId)!.amount, 0),
      "Confirmed Fraud": ds.filter((d) => d.label === "FRAUD").length, "Not Fraud": ds.filter((d) => d.label === "NOT_FRAUD").length,
    };
  }).sort((x, y) => (y["Alerts"] as number) - (x["Alerts"] as number));
}

export function buildReport(s: State, type: ReportType, f: ReportFilter): Row[] {
  const alerts = filterAlerts(s, f);
  switch (type) {
    case "alerts": return alerts.map((a) => detail(s, a));
    case "held": return alerts.map((a) => detail(s, a)).filter((r) => ["HELD", "DECLINED", "CHALLENGE_SENT"].includes(r["Transaction Status"] as string));
    case "decisions": return alerts.flatMap((a) => {
      const d = s.decisions.find((x) => x.alertId === a.id);
      return d ? [{ "Alert ID": a.id, "Alert Created": dt(a.createdAt), "Decided At": dt(d.decidedAt), "Decided By": d.decidedBy, "Decision": d.action, "Outcome": d.label,
        "Followed AI": d.followedAi ? "Yes" : "No", "Amount (IDR)": d.amount, "Reason": d.reason ?? "" }] : [];
    });
    case "customers": return summary(alerts, s, (a) => toRow(s, a).customerName, "Customer");
    case "risk": return summary(alerts, s, (a) => a.baselineLevel, "Risk Level");
    case "str": return strRows(s, f);
    case "ojk": return ojkRows(s, f);
    case "audit": return auditRows(s, f);
  }
}

// Headline numbers for the filtered period, shown above every sub-report and as a "Summary" sheet in the export.
export function reportSummary(s: State, f: ReportFilter) {
  const alerts = filterAlerts(s, f), ids = new Set(alerts.map((a) => a.id));
  const tx = (a: Alert) => s.transactions.find((t) => t.id === a.transactionId)!;
  const ds = s.decisions.filter((d) => ids.has(d.alertId)), fraud = ds.filter((d) => d.label === "FRAUD").length;
  const level = (l: string) => alerts.filter((a) => a.baselineLevel === l).length;
  return {
    alerts: alerts.length, amount: alerts.reduce((n, a) => n + tx(a).amount, 0),
    high: level("HIGH"), medium: level("MEDIUM"), low: level("LOW"),
    open: alerts.filter((a) => a.status !== "Decided").length, decided: ds.length, fraud, notFraud: ds.length - fraud,
    fraudRate: ds.length ? fraud / ds.length : null, // confirmed fraud share of decided alerts
    fraudAmount: ds.filter((d) => d.label === "FRAUD").reduce((n, d) => n + d.amount, 0),
    // Recovery = confirmed-fraud money stopped (declined / frozen) ÷ all confirmed-fraud money.
    recoveryRate: fraud ? ds.filter((d) => d.label === "FRAUD" && d.action !== "APPROVE").reduce((n, d) => n + d.amount, 0) / ds.filter((d) => d.label === "FRAUD").reduce((n, d) => n + d.amount, 0) || 0 : null,
    prevented: ds.filter((d) => d.action !== "APPROVE").reduce((n, d) => n + d.amount, 0),
    onHold: alerts.filter((a) => tx(a).status === "HELD").reduce((n, a) => n + tx(a).amount, 0),
    aiAgreement: ds.length ? ds.filter((d) => d.followedAi).length / ds.length : null,
    avgScore: alerts.length ? Math.round(alerts.reduce((n, a) => n + a.baselineScore, 0) / alerts.length) : 0,
  };
}
export type ReportSummary = ReturnType<typeof reportSummary>;

export function summaryRows(m: ReportSummary, f: ReportFilter): Row[] {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  return [
    ["Period", `${f.from || "start"} to ${f.to || "today"}`], ["Alert ID filter", f.alertId || "—"],
    ["Total alerts", m.alerts], ["Total amount (IDR)", m.amount], ["High / Medium / Low", `${m.high} / ${m.medium} / ${m.low}`],
    ["Open alerts", m.open], ["Decided alerts", m.decided], ["Confirmed fraud", m.fraud], ["Not fraud", m.notFraud],
    ["Fraud rate (of decided)", pct(m.fraudRate)], ["Confirmed fraud amount (IDR)", m.fraudAmount], ["Recovery rate", pct(m.recoveryRate)], ["Loss prevented (IDR)", m.prevented], ["Amount on hold (IDR)", m.onHold],
    ["AI agreement", pct(m.aiAgreement)], ["Average risk score", m.avgScore],
  ].map(([k, v]) => ({ Metric: k, Value: v }));
}

// Chart data for the filtered alerts: top rules, daily trend, categories. "fraud" = analyst-confirmed FRAUD.
export function reportCharts(s: State, f: ReportFilter) {
  const alerts = filterAlerts(s, f), isFraud = (a: Alert) => s.decisions.some((d) => d.alertId === a.id && d.label === "FRAUD");
  const tally = (key: (a: Alert) => string) => {
    const m = new Map<string, { flagged: number; fraud: number }>();
    for (const a of alerts) { const k = key(a), v = m.get(k) ?? { flagged: 0, fraud: 0 }; v.flagged++; if (isFraud(a)) v.fraud++; m.set(k, v); }
    return [...m].map(([label, v]) => ({ label, ...v })).sort((x, y) => y.fraud - x.fraud || y.flagged - x.flagged);
  };
  const days: string[] = [];
  const last = f.to ?? jkt(new Date().toISOString()), first = f.from ?? (alerts.length ? jkt(alerts[alerts.length - 1].createdAt) : last);
  for (let d = new Date(`${first}T00:00:00Z`); jkt(d.toISOString()) <= last && days.length < 366; d = new Date(+d + 864e5)) days.push(d.toISOString().slice(0, 10));
  const byDay = new Map(tally((a) => jkt(a.createdAt)).map((r) => [r.label, r]));
  return {
    byRule: tally((a) => ruleNameOf(s, a)).slice(0, 10),
    daily: days.map((d) => ({ day: d, flagged: byDay.get(d)?.flagged ?? 0, fraud: byDay.get(d)?.fraud ?? 0 })),
    byCategory: tally((a) => categoryOf(s, a)),
    rules: [...new Set(s.alerts.map((a) => ruleNameOf(s, a)))].sort(), // filter options, independent of the current filter
  };
}

const csvCell = (v: unknown) => { const t = String(v ?? ""); return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : "") + t.replace(/"/g, '""')}"` : t; }; // quote + neutralise spreadsheet formulas
export const toCsv = (rows: Row[]) => { const cols = Object.keys(rows[0] ?? {}); return "\uFEFF" + [cols, ...rows.map((r) => cols.map((c) => r[c]))].map((l) => l.map(csvCell).join(",")).join("\r\n"); };

const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Excel 2003 XML (SpreadsheetML): opens natively in Excel with typed numbers, no dependency, no locale CSV-separator issues.
export function toExcelXml(sheets: { name: string; rows: Row[] }[]) {
  const row = (vals: unknown[]) => `<Row>${vals.map((v) => `<Cell><Data ss:Type="${typeof v === "number" ? "Number" : "String"}">${esc(v)}</Data></Cell>`).join("")}</Row>`;
  const sheet = ({ name, rows }: { name: string; rows: Row[] }) => {
    const cols = Object.keys(rows[0] ?? {});
    return `<Worksheet ss:Name="${esc(name.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"))}"><Table>${row(cols)}${rows.map((r) => row(cols.map((c) => r[c]))).join("")}</Table></Worksheet>`;
  };
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(sheet).join("")}</Workbook>`;
}
