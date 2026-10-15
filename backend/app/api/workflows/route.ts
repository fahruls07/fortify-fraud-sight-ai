import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { log, summary } from "@/lib/wfapi";
import { API_OF, servesApi } from "@/lib/flows";
import { newWorkflow, validateWorkflow } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(getStore().workflows.map((w) => ({ ...summary(w), serves: servesApi(w) ? API_OF[servesApi(w)!] : null })));

export async function POST(req: Request) {
  const v = validateWorkflow(await req.json().catch(() => null));
  if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
  const s = getStore(), by = userFrom(req);
  const w = newWorkflow(`wf_${String(s.nextWfSeq++).padStart(3, "0")}`, v.workflow, by);
  s.workflows.push(w);
  log(by, w, "CREATE_WORKFLOW");
  return Response.json(summary(w), { status: 201 });
}
