import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { publicConfig, updateSection, type Config } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(publicConfig());

// Body: { section, values, clear?: ["notification.smtp.pass", …] }. Secrets left empty keep their stored value.
export async function PUT(req: Request) {
  const b = await req.json().catch(() => ({}));
  const err = updateSection(b.section as keyof Config, b.values, Array.isArray(b.clear) ? b.clear : []);
  if (err) return Response.json({ error: err }, { status: 400 });
  const by = userFrom(req);
  audit({ actor: by, entityType: "user", entityId: `settings.${b.section}`, action: "UPDATE_SETTINGS", before: {}, after: { section: b.section, fields: Object.keys(b.values ?? {}) } }); // field names only, never values (secrets)
  return Response.json(publicConfig());
}
