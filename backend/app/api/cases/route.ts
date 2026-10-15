import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { createCase } from "@/lib/cases";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(getStore().cases.map(({ events, ...c }) => ({ ...c, events: events.length }))); // eslint-disable-line @typescript-eslint/no-unused-vars

export async function POST(req: Request) {
  const s = getStore(), by = userFrom(req), c = createCase(s, await req.json().catch(() => ({})), by);
  if (typeof c === "string") return Response.json({ error: c }, { status: 400 });
  audit({ actor: by, entityType: "alert", entityId: c.id, action: "CREATE_CASE", before: {}, after: { alertIds: c.alertIds, priority: c.priority } });
  return Response.json(c, { status: 201 });
}
