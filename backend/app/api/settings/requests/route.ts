import { listRequests, submitRequest } from "@/lib/acm";
import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(listRequests());

// Maker submits an access change; it stays PENDING until a checker decides.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const maker = userFrom(req), r = submitRequest(maker, b);
  if (typeof r === "string") return Response.json({ error: r }, { status: 400 });
  const s = getStore();
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: r.createdAt, actor: maker, entityType: "user", entityId: r.target, action: `SUBMIT_${r.type}`, before: { ...r.before }, after: { ...r.after, ...(r.passwordReset && { passwordReset: true }) }, reason: r.id, aiRecommendation: null });
  return Response.json(r, { status: 201 });
}
