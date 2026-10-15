import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { revokeKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, err = revokeKey(id);
  if (err) return Response.json({ error: err }, { status: 400 });
  audit({ actor: userFrom(req), entityType: "user", entityId: id, action: "REVOKE_API_KEY", before: { status: "ACTIVE" }, after: { status: "REVOKED" } });
  return Response.json({ ok: true });
}
