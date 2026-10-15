import { runDeployed, servingWorkflow } from "@/lib/flows";
import { errorResponse, submitEvent } from "@/lib/transfers";

export const dynamic = "force-dynamic";

// Banking app: score a login attempt (ALLOW / CHALLENGE / DENY). Decided by the workflow set to serve this API, or the built-in event score.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})), w = servingWorkflow("login_attempt");
    if (w) {
      const r = (await runDeployed(w, body, false, false)) as { eventId?: string; decision: string; score?: number; reasons?: string[]; message?: string };
      return Response.json({ eventId: r.eventId, decision: r.decision, score: r.score, reasons: r.reasons, message: r.message, decidedBy: `workflow ${w.id} v${w.deployedVersion}` });
    }
    return Response.json({ ...submitEvent("login_attempt", body), decidedBy: "built-in" });
  } catch (e) { return errorResponse(e); }
}
