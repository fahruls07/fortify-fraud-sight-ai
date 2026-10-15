import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, s = getStore(), i = s.amlList.findIndex((e) => e.id === id);
  if (i < 0) return Response.json({ error: "Entry not found." }, { status: 404 });
  const [e] = s.amlList.splice(i, 1);
  audit({ actor: userFrom(req), entityType: "rule", entityId: id, action: "REMOVE_AML_ENTRY", before: { name: e.name, type: e.type }, after: {} });
  return Response.json({ ok: true });
}
