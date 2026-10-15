import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { listUsers } from "@/lib/auth";
import { publish } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, s = getStore(), a = s.alerts.find((x) => x.id === id);
  if (!a) return Response.json({ error: "Alert not found." }, { status: 404 });
  const { assignee } = await req.json().catch(() => ({}));
  if (assignee !== "" && (typeof assignee !== "string" || !listUsers().includes(assignee))) return Response.json({ error: "Unknown user." }, { status: 400 });
  const before = a.assignedTo; a.assignedTo = assignee;
  audit({ actor: userFrom(req), entityType: "alert", entityId: id, action: "ASSIGN", before: { assignedTo: before }, after: { assignedTo: assignee || "unassigned" } });
  publish("alert.updated", s, a);
  return Response.json(a);
}
