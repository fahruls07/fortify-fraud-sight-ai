import { listAlerts } from "@/lib/alerts";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const rows = listAlerts(getStore(), q.get("status"), q.get("risk"));
  return rows ? Response.json(rows) : Response.json({ error: "invalid status or risk filter" }, { status: 400 });
}
