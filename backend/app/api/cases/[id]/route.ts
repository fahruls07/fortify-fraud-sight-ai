import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { listUsers } from "@/lib/auth";
import { updateCase } from "@/lib/cases";
import { toRow } from "@/lib/alerts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params, s = getStore(), c = s.cases.find((x) => x.id === id);
  if (!c) return Response.json({ error: "Case not found." }, { status: 404 });
  return Response.json({ ...c, alerts: c.alertIds.map((a) => s.alerts.find((x) => x.id === a)).filter((a) => !!a).map((a) => ({ ...toRow(s, a), hits: a.hits ?? [] })) });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params, s = getStore(), c = s.cases.find((x) => x.id === id);
  if (!c) return Response.json({ error: "Case not found." }, { status: 404 });
  const by = userFrom(req), err = updateCase(s, c, await req.json().catch(() => ({})), by, listUsers());
  if (err) return Response.json({ error: err }, { status: 400 });
  audit({ actor: by, entityType: "alert", entityId: c.id, action: "UPDATE_CASE", before: {}, after: { status: c.status, assignee: c.assignee, priority: c.priority } });
  return Response.json(c);
}
