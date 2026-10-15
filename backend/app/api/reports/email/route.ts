import { userFrom } from "@/lib/auth";
import { parseRecipients } from "@/lib/mailer";
import { parseReportQuery } from "@/lib/reportfile";
import { emailReport } from "@/lib/schedules";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Body: { to, query (the report's URL query string), format, message }
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const to = parseRecipients(b.to);
  if (typeof to === "string") return Response.json({ error: to }, { status: 400 });
  const p = parseReportQuery(new URLSearchParams(typeof b.query === "string" ? b.query : ""));
  if (typeof p === "string") return Response.json({ error: p }, { status: 400 });
  const format = b.format === "csv" ? "csv" : "xls", note = typeof b.message === "string" ? b.message.slice(0, 1000) : "";
  try {
    const r = await emailReport(to, p.type, p.f, format, note);
    const s = getStore(), by = userFrom(req);
    s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: new Date().toISOString(), actor: by, entityType: "user", entityId: by, action: "EMAIL_REPORT", before: {}, after: { to, type: p.type, format }, reason: null, aiRecommendation: null });
    return Response.json({ ok: true, ...r, to });
  } catch (e) { return Response.json({ error: `Could not send: ${(e as Error).message}` }, { status: 502 }); }
}
