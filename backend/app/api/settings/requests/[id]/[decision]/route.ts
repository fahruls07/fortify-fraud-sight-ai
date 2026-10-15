import { decideRequest } from "@/lib/acm";
import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; decision: string }> }) {
  const { id, decision } = await params;
  if (decision !== "approve" && decision !== "reject") return Response.json({ error: "Not found." }, { status: 404 });
  const { note } = await req.json().catch(() => ({}));
  const checker = userFrom(req), r = decideRequest(checker, id, decision === "approve", typeof note === "string" ? note : undefined);
  if (typeof r === "string") return Response.json({ error: r }, { status: 400 });
  const s = getStore();
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: r.decidedAt!, actor: checker, entityType: "user", entityId: r.target, action: `${decision === "approve" ? "APPROVE" : "REJECT"}_${r.type}`, before: { ...r.before }, after: { ...r.after }, reason: r.note ?? r.id, aiRecommendation: null });
  return Response.json(r);
}
