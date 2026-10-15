import { geminiConfigured } from "@/lib/copilot/gemini";
import { overview, RANGES, SEVERITIES, STATUSES, type Range } from "@/lib/overview";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const range = (q.get("range") ?? "24h") as Range, severity = q.get("severity"), status = q.get("status");
  if (!(range in RANGES) || (severity && !SEVERITIES.includes(severity as never)) || (status && !STATUSES.includes(status as never)))
    return Response.json({ error: "invalid range, severity or status" }, { status: 400 });
  const o = overview(getStore(), { range, severity, status });
  return Response.json({ ...o, aiMode: geminiConfigured() && o.aiMode === "live" ? "live" : "fallback" });
}
