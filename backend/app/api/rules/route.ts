import { validateRule, type Rule } from "@/lib/rules/dsl";
import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = () => Response.json([...getStore().rules].reverse()); // newest first

export async function POST(req: Request) {
  const s = getStore();
  const v = validateRule(await req.json().catch(() => null));
  if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
  const rule: Rule = { ...v.rule, id: `RULE-${String(s.nextRuleSeq++).padStart(4, "0")}`, status: "Draft", createdBy: userFrom(req), createdAt: new Date().toISOString() };
  s.rules.push(rule);
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: rule.createdAt, actor: rule.createdBy, entityType: "rule", entityId: rule.id, action: "CREATE_RULE", before: {}, after: { status: "Draft", expression: rule.expression }, reason: null, aiRecommendation: null });
  return Response.json(rule, { status: 201 });
}
