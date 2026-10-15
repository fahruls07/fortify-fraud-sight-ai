import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Stored only: the baseline scoring engine does not execute active rules (06 §5, §8).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = getStore();
  const { id } = await params;
  const rule = s.rules.find((r) => r.id === id);
  if (!rule) return Response.json({ error: "rule not found" }, { status: 404 });
  if (rule.status === "Active") return Response.json({ error: "rule already active" }, { status: 409 });
  rule.status = "Active"; rule.updatedAt = new Date().toISOString(); rule.updatedBy = userFrom(req);
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: new Date().toISOString(), actor: userFrom(req), entityType: "rule", entityId: id, action: "ACTIVATE_RULE", before: { status: "Draft" }, after: { status: "Active" }, reason: null, aiRecommendation: null });
  return Response.json(rule);
}
