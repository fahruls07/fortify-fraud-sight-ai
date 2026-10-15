import { userFrom } from "@/lib/auth";
import { exportPack } from "@/lib/rules/pack";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// ?ids=RULE-0001,RULE-0002 exports a subset; default all.
export function GET(req: Request) {
  const ids = new URL(req.url).searchParams.get("ids")?.split(",").filter(Boolean);
  const rules = getStore().rules.filter((r) => !ids?.length || ids.includes(r.id));
  if (!rules.length) return Response.json({ error: "No rules to export." }, { status: 404 });
  return new Response(new Uint8Array(exportPack(rules, userFrom(req))), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="fortify-rules-${new Date().toISOString().slice(0, 10)}.zip"` },
  });
}
