import { userFrom } from "@/lib/auth";
import { parsePack } from "@/lib/rules/pack";
import type { Rule } from "@/lib/rules/dsl";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX = 5 * 1024 * 1024;

// multipart: "file" = the .zip. Without "files" it only previews the package.
// With "files" (JSON array of file names from the preview) it imports exactly those, all as new Drafts (never auto-active).
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Upload a .zip file in field \"file\"." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "File is larger than 5 MB." }, { status: 413 });
  const p = parsePack(Buffer.from(await file.arrayBuffer()));
  if ("errors" in p) return Response.json({ error: "Cannot read this package.", details: p.errors }, { status: 400 });
  const sel = form!.get("files");
  if (typeof sel !== "string") return Response.json({ items: p.items });

  let wanted: unknown;
  try { wanted = JSON.parse(sel); } catch { wanted = null; }
  if (!Array.isArray(wanted) || !wanted.length) return Response.json({ error: "Select at least one rule to import." }, { status: 400 });
  const picked = p.items.filter((i) => wanted.includes(i.file));
  const bad = picked.filter((i) => !i.rule);
  if (picked.length !== wanted.length || bad.length) return Response.json({ error: "Some selected rules are invalid. Nothing was imported.", details: bad.map((i) => `${i.file}: ${i.error}`) }, { status: 400 });

  const s = getStore(), by = userFrom(req), at = new Date().toISOString();
  const created: Rule[] = picked.map(({ rule }) => ({ ...rule!, id: `RULE-${String(s.nextRuleSeq++).padStart(4, "0")}`, status: "Draft", createdBy: by, createdAt: at }));
  for (const r of created) {
    s.rules.push(r);
    s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at, actor: by, entityType: "rule", entityId: r.id, action: "IMPORT_RULE", before: {}, after: { status: "Draft", expression: r.expression }, reason: file.name, aiRecommendation: null });
  }
  return Response.json({ imported: created.map((r) => r.id) }, { status: 201 });
}
