import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { detail, log } from "@/lib/wfapi";
import { DEFAULT_ROUTE, FIELDS, runWorkflow, SAMPLE_FIELDS, saveVersion, SOURCES, TRIGGERS, validateWorkflow, type TestEvent } from "@/lib/workflows";
import { services } from "@/lib/wfservices";
import { API_OF, runDeployed, servesApi, SLUG, slugify } from "@/lib/flows";
import { errorResponse } from "@/lib/transfers";

export const dynamic = "force-dynamic";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// POST /api/workflows/{id}/{deploy|archive|restore|rollback|test}. "test" also works for unsaved drafts (id "draft").
export async function POST(req: Request, { params }: { params: Promise<{ id: string; op: string }> }) {
  const { id, op } = await params, b = await req.json().catch(() => ({})), by = userFrom(req);
  if (op === "test") {
    const v = validateWorkflow(b.workflow);
    if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
    const e = b.event ?? {}, fields = { ...SAMPLE_FIELDS, ...(e.fields ?? {}) };
    if (!(e.event in TRIGGERS) || !(e.source in SOURCES) || e.source === "any") return Response.json({ error: "event needs event and source" }, { status: 400 });
    for (const [k, f] of Object.entries(FIELDS)) if (typeof fields[k as keyof typeof fields] !== f.type) return Response.json({ error: `event field ${k} must be a ${f.type}` }, { status: 400 });
    return Response.json(await runWorkflow(v.workflow, { event: e.event, source: e.source, fields } as TestEvent, services())); // dry run, nothing stored
  }
  const w = getStore().workflows.find((x) => x.id === id);
  if (!w) return Response.json({ error: "Workflow not found." }, { status: 404 });
  // Default workflows are bound to their built-in route: no custom endpoint, no archive.
  if (w.role && ["publish", "unpublish", "endpoint-on", "endpoint-off", "archive"].includes(op))
    return Response.json({ error: `"${w.name}" is a default workflow: it is served only at POST ${DEFAULT_ROUTE[w.role]} and cannot be ${op === "archive" ? "archived" : "published on another route"}.`, code: "DEFAULT_WORKFLOW" }, { status: 409 });
  if (op === "deploy") {
    if (w.status === "Archived") return Response.json({ error: "Restore the workflow before deploying it." }, { status: 409 });
    Object.assign(w, { status: "Active", deployedVersion: w.version, deployedAt: new Date().toISOString() });
    log(by, w, "DEPLOY_WORKFLOW", { deployedVersion: w.version });
  } else if (op === "archive") {
    if (w.status === "Archived") return Response.json({ error: "Already archived." }, { status: 409 });
    w.status = "Archived"; log(by, w, "ARCHIVE_WORKFLOW");
  } else if (op === "restore") {
    if (w.status !== "Archived") return Response.json({ error: "Only archived workflows can be restored." }, { status: 409 });
    w.status = "Draft"; log(by, w, "RESTORE_WORKFLOW");
  } else if (op === "rollback") {
    const v = w.versions.find((x) => x.version === b.version);
    if (!v) return Response.json({ error: "Version not found." }, { status: 404 });
    if (w.status === "Archived") return Response.json({ error: "Restore the workflow first." }, { status: 409 });
    saveVersion(w, { name: v.name, description: v.description, nodes: v.nodes, edges: v.edges }, by, `Rollback to v${v.version}`);
    log(by, w, "ROLLBACK_WORKFLOW", { from: v.version });
  } else if (op === "publish") {
    const slug = typeof b.slug === "string" && b.slug.trim() ? b.slug.trim().toLowerCase() : slugify(w.name);
    if (!SLUG.test(slug)) return Response.json({ error: "Endpoint name: 3–50 characters, lowercase letters, digits and hyphens." }, { status: 400 });
    if (getStore().workflows.some((x) => x !== w && x.endpoint?.slug === slug)) return Response.json({ error: `/api/flows/${slug} is already used by another workflow.` }, { status: 409 });
    w.endpoint = { slug, enabled: w.endpoint?.enabled ?? false, publishedAt: w.endpoint?.publishedAt ?? new Date().toISOString(), publishedBy: by, calls: w.endpoint?.calls ?? 0, lastCallAt: w.endpoint?.lastCallAt };
    log(by, w, "PUBLISH_WORKFLOW_ENDPOINT", { slug });
  } else if (op === "unpublish") {
    if (!w.endpoint) return Response.json({ error: "Not published." }, { status: 409 });
    log(by, w, "UNPUBLISH_WORKFLOW_ENDPOINT", { slug: w.endpoint.slug }); delete w.endpoint;
  } else if (op === "endpoint-on" || op === "endpoint-off") {
    if (!w.endpoint) return Response.json({ error: "Publish the endpoint first." }, { status: 409 });
    if (op === "endpoint-on" && (w.status !== "Active" || !w.deployedVersion)) return Response.json({ error: "Deploy the workflow before activating its endpoint." }, { status: 409 });
    w.endpoint.enabled = op === "endpoint-on";
    log(by, w, op === "endpoint-on" ? "ACTIVATE_WORKFLOW_ENDPOINT" : "DEACTIVATE_WORKFLOW_ENDPOINT", { slug: w.endpoint.slug });
  } else if (op === "try") {
    // Console dry run of the deployed version with full detail (endpoint or not). Nothing is saved or sent.
    try { return Response.json(await runDeployed(w, isObj(b.payload) ? b.payload : {}, true, false)); }
    catch (e) { return errorResponse(e); }
  } else return Response.json({ error: "Unknown operation." }, { status: 404 });
  return Response.json({ ...detail(w), serves: servesApi(w) ? API_OF[servesApi(w)!] : null });
}
