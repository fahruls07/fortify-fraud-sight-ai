import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getStore } from "@/lib/store";
import { entityOk, MAX_BYTES, saveAttachment } from "@/lib/cases";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const entity = new URL(req.url).searchParams.get("entity") ?? "", s = getStore();
  if (!entityOk(s, entity)) return Response.json({ error: "Unknown alert or case." }, { status: 404 });
  return Response.json(s.attachments.filter((a) => a.entity === entity));
}

// multipart: entity + file.
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return Response.json({ error: "File must be at most 5 MB." }, { status: 413 });
  const form = await req.formData().catch(() => null), file = form?.get("file"), entity = String(form?.get("entity") ?? "");
  if (!(file instanceof File)) return Response.json({ error: "Attach a file." }, { status: 400 });
  const s = getStore(), by = userFrom(req), a = saveAttachment(s, entity, file.name, file.type, Buffer.from(await file.arrayBuffer()), by);
  if (typeof a === "string") return Response.json({ error: a }, { status: 400 });
  audit({ actor: by, entityType: "alert", entityId: entity.split(":")[1], action: "ADD_ATTACHMENT", before: {}, after: { name: a.name, size: a.size } });
  return Response.json(a, { status: 201 });
}
