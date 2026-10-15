import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { addToCase } from "@/lib/cases";

export const dynamic = "force-dynamic";

// Merge more alerts into an existing case.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, s = getStore(), c = s.cases.find((x) => x.id === id);
  if (!c) return Response.json({ error: "Case not found." }, { status: 404 });
  if (c.status === "CLOSED") return Response.json({ error: "Reopen the case before adding alerts." }, { status: 409 });
  const { alertIds } = await req.json().catch(() => ({}));
  if (!Array.isArray(alertIds) || !alertIds.length) return Response.json({ error: "alertIds is required." }, { status: 400 });
  const by = userFrom(req), err = addToCase(s, c, alertIds.map(String), by);
  if (err) return Response.json({ error: err }, { status: 400 });
  audit({ actor: by, entityType: "alert", entityId: c.id, action: "MERGE_ALERTS", before: {}, after: { alertIds } });
  return Response.json(c);
}
