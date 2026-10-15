import { userFrom } from "@/lib/auth";
import { validateRule } from "@/lib/rules/dsl";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  const rule = getStore().rules.find((r) => r.id === id);
  return rule ? Response.json(rule) : Response.json({ error: "rule not found" }, { status: 404 });
}

// Update in place. A changed rule goes back to Draft so it must be backtested/activated again.
export async function PUT(req: Request, { params }: Ctx) {
  const s = getStore();
  const { id } = await params;
  const rule = s.rules.find((r) => r.id === id);
  if (!rule) return Response.json({ error: "rule not found" }, { status: 404 });
  const v = validateRule(await req.json().catch(() => null));
  if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
  const before = { status: rule.status, expression: rule.expression };
  Object.assign(rule, v.rule, { status: "Draft", updatedAt: new Date().toISOString(), updatedBy: userFrom(req) });
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: new Date().toISOString(), actor: userFrom(req), entityType: "rule", entityId: id, action: "UPDATE_RULE", before, after: { status: "Draft", expression: rule.expression }, reason: null, aiRecommendation: null });
  return Response.json(rule);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const s = getStore();
  const { id } = await params;
  const i = s.rules.findIndex((r) => r.id === id);
  if (i < 0) return Response.json({ error: "rule not found" }, { status: 404 });
  if (s.rules[i].status === "Active") return Response.json({ error: "Deactivate the rule before deleting it." }, { status: 409 });
  const [rule] = s.rules.splice(i, 1);
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: new Date().toISOString(), actor: userFrom(req), entityType: "rule", entityId: id, action: "DELETE_RULE", before: { status: rule.status, expression: rule.expression }, after: {}, reason: null, aiRecommendation: null });
  return Response.json({ ok: true });
}
