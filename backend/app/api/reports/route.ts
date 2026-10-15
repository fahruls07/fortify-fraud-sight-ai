import { buildReport, reportCharts, reportSummary } from "@/lib/report";
import { parseReportQuery, reportFile } from "@/lib/reportfile";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams, p = parseReportQuery(q);
  if (typeof p === "string") return Response.json({ error: p }, { status: 400 });
  const format = q.get("format");
  if (format === "xml" && p.type !== "str") return Response.json({ error: "XML is only available for the STR report" }, { status: 400 });
  if (format === "xls" || format === "csv" || format === "xml") {
    const file = reportFile(p.type, p.f, format);
    return new Response(file.body, { headers: { "Content-Type": file.mime, "Content-Disposition": `attachment; filename="${file.name}"` } });
  }
  const s = getStore();
  return Response.json({ rows: buildReport(s, p.type, p.f), summary: reportSummary(s, p.f), charts: reportCharts(s, p.f) });
}
