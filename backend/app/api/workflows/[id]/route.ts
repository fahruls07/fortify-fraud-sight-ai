import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { detail, log } from "@/lib/wfapi";
import { API_OF, servesApi } from "@/lib/flows";
import { DEFAULT_ROUTE, saveVersion, validateWorkflow } from "@/lib/workflows";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const find = async ({ params }: Ctx) => { const { id } = await params; return getStore().workflows.find((x) => x.id === id); };
const missing = () => Response.json({ error: "Workflow not found." }, { status: 404 });

export async function GET(_: Request, ctx: Ctx) { const w = await find(ctx); return w ? Response.json({ ...detail(w), serves: servesApi(w) ? API_OF[servesApi(w)!] : null }) : missing(); }

// Save = new version. The live (deployed) version keeps running until the next Deploy.
export async function PUT(req: Request, ctx: Ctx) {
  const w = await find(ctx); if (!w) return missing();
  if (w.status === "Archived") return Response.json({ error: "Restore the workflow before editing it." }, { status: 409 });
  const b = await req.json().catch(() => null), v = validateWorkflow(b);
  if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
  const trig = (v.workflow.nodes.find((n) => n.type === "trigger")?.data as { event?: string })?.event;
  if (w.role && (trig !== w.role || v.workflow.nodes.filter((n) => n.type === "trigger").length !== 1))
    return Response.json({ error: `"${w.name}" serves POST ${DEFAULT_ROUTE[w.role]}: it must keep exactly one ${w.role.replace("_", " ")} trigger.`, code: "DEFAULT_WORKFLOW" }, { status: 409 });
  saveVersion(w, v.workflow, userFrom(req), typeof b?.note === "string" ? b.note.trim().slice(0, 120) : "");
  log(userFrom(req), w, "UPDATE_WORKFLOW");
  return Response.json(detail(w));
}

export async function DELETE(req: Request, ctx: Ctx) {
  const w = await find(ctx); if (!w) return missing();
  if (w.role) return Response.json({ error: `"${w.name}" is a default workflow serving POST ${DEFAULT_ROUTE[w.role]} and cannot be deleted.`, code: "DEFAULT_WORKFLOW" }, { status: 409 });
  if (w.status === "Active") return Response.json({ error: "Archive the workflow before deleting it." }, { status: 409 });
  const s = getStore(); s.workflows.splice(s.workflows.indexOf(w), 1);
  log(userFrom(req), w, "DELETE_WORKFLOW");
  return Response.json({ ok: true });
}
