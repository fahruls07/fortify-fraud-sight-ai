import { runDeployed, servingWorkflow } from "@/lib/flows";
import { ApiError, errorResponse, submitTransfer } from "@/lib/transfers";

export const dynamic = "force-dynamic";

// Score a transfer before money moves. If a workflow is set to serve this API, its deployed version decides;
// otherwise the built-in pipeline does (baseline + amount escalation + watchlists + AML + active rules).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => { throw new ApiError(400, "body must be JSON"); });
    const w = servingWorkflow("transaction_created");
    if (w) {
      const r = (await runDeployed(w, body, false, false)) as { decision: string; transactionId?: string; status?: string; message?: string };
      return Response.json({ decision: r.decision, transactionId: r.transactionId, status: r.status, message: r.message, decidedBy: `workflow ${w.id} v${w.deployedVersion}` });
    }
    const r = submitTransfer(body);
    return Response.json({ decision: r.decision, transactionId: r.transactionId, status: r.status, message: r.message, decidedBy: "built-in" });
  } catch (e) { return errorResponse(e); }
}
