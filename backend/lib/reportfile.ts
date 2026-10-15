import { buildReport, REPORTS, reportSummary, summaryRows, toCsv, toExcelXml, type ReportFilter, type ReportType } from "./report.ts";
import { getStore } from "./store.ts";
import { strXml } from "./regulatory.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEV = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// Shared by the download route and the email/schedule sender.
export function parseReportQuery(q: URLSearchParams): { type: ReportType; f: ReportFilter } | string {
  const type = (q.get("type") ?? "alerts") as ReportType, from = q.get("from"), to = q.get("to"), severity = q.get("severity");
  if (!(type in REPORTS) || (from && !DATE.test(from)) || (to && !DATE.test(to)) || (severity && !SEV.includes(severity))) return "invalid type, date or severity";
  return { type, f: { from, to, alertId: q.get("alertId"), severity, rule: q.get("rule"), q: q.get("q") } };
}

export function reportFile(type: ReportType, f: ReportFilter, format: "xls" | "csv" | "xml") {
  const s = getStore(), rows = buildReport(s, type, f), stamp = new Date().toISOString().slice(0, 10);
  if (format === "xml") return { name: `ppatk-str-draft-${stamp}.xml`, mime: "application/xml; charset=utf-8", body: strXml(rows) };
  return format === "csv"
    ? { name: `fraud-report-${type}-${stamp}.csv`, mime: "text/csv; charset=utf-8", body: toCsv(rows) }
    : { name: `fraud-report-${type}-${stamp}.xls`, mime: "application/vnd.ms-excel", body: toExcelXml([{ name: "Summary", rows: summaryRows(reportSummary(s, f), f) }, { name: REPORTS[type], rows }]) };
}
