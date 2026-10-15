import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { validateListEntry, type ListEntry } from "@/lib/intel";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(getStore().watchlist);

export async function POST(req: Request) {
  const v = validateListEntry(await req.json().catch(() => ({})));
  if (typeof v === "string") return Response.json({ error: v }, { status: 400 });
  const s = getStore(), by = userFrom(req);
  if (s.watchlist.some((e) => e.list === v.list && e.type === v.type && e.value.toLowerCase() === v.value.toLowerCase())) return Response.json({ error: "That entry is already on the list." }, { status: 409 });
  const e: ListEntry = { ...v, id: `WL-${String(s.nextIntelSeq++).padStart(5, "0")}`, createdBy: by, createdAt: new Date().toISOString(), hits: 0 };
  s.watchlist.unshift(e);
  audit({ actor: by, entityType: "rule", entityId: e.id, action: `ADD_${e.list}LIST`, before: {}, after: { type: e.type, value: e.value, reason: e.reason } });
  return Response.json(e, { status: 201 });
}
