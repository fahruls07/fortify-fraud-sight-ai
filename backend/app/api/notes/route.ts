import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { addNote, entityOk } from "@/lib/cases";

export const dynamic = "force-dynamic";

// Analyst notes on an alert ("alert:ALT-0001") or a case ("case:CASE-0001").
export function GET(req: Request) {
  const entity = new URL(req.url).searchParams.get("entity") ?? "", s = getStore();
  if (!entityOk(s, entity)) return Response.json({ error: "Unknown alert or case." }, { status: 404 });
  return Response.json(s.notes.filter((n) => n.entity === entity));
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({})), s = getStore(), by = userFrom(req);
  const n = addNote(s, String(b.entity ?? ""), b.text, by);
  if (typeof n === "string") return Response.json({ error: n }, { status: 400 });
  audit({ actor: by, entityType: "alert", entityId: n.entity.split(":")[1], action: "ADD_NOTE", before: {}, after: { note: n.text.slice(0, 120) } });
  return Response.json(n, { status: 201 });
}
