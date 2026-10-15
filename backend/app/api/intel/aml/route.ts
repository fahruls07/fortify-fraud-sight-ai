import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { validateAml, type AmlEntry } from "@/lib/intel";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(getStore().amlList);

export async function POST(req: Request) {
  const v = validateAml(await req.json().catch(() => ({})));
  if (typeof v === "string") return Response.json({ error: v }, { status: 400 });
  const s = getStore(), by = userFrom(req);
  const e: AmlEntry = { ...v, id: `AML-${String(s.nextIntelSeq++).padStart(5, "0")}`, createdBy: by, createdAt: new Date().toISOString() };
  s.amlList.unshift(e);
  audit({ actor: by, entityType: "rule", entityId: e.id, action: "ADD_AML_ENTRY", before: {}, after: { name: e.name, type: e.type } });
  return Response.json(e, { status: 201 });
}
