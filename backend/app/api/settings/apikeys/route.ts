import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { createKey, listKeys } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(listKeys());

// Returns the full key exactly once; only its hash is stored.
export async function POST(req: Request) {
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Give the key a name, e.g. Internet Banking (prod)." }, { status: 400 });
  const by = userFrom(req), { key, record } = createKey(name, by);
  audit({ actor: by, entityType: "user", entityId: record.id, action: "CREATE_API_KEY", before: {}, after: { name: record.name, prefix: record.prefix } });
  return Response.json({ key, record }, { status: 201 });
}
