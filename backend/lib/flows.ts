import { audit } from "./auditlog.ts";
import { sendNotice, sendToCustomer } from "./custchannel.ts";
import { slack, telegram } from "./integrations.ts";
import { config } from "./settings.ts";
import { getStore } from "./store";
import { ApiError, commitOutcome, DECISION, EVENT_MESSAGE, prepareEvent, prepareTransfer, transactionStatus, type TransferInput } from "./transfers";
import { DEFAULT_ROUTE, deployed, runWorkflow, type Workflow } from "./workflows.ts";
import { eventFromRisk, eventOf } from "./workflowrun.ts";
import { services } from "./wfservices.ts";

// Published workflow endpoints: POST /api/flows/{slug}. The banking app calls the endpoint and the workflow's DEPLOYED
// version decides the outcome for real. Strictest fired action wins: block > challenge > review > allow.
export const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
export const slugify = (n: string) => n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "workflow";
const MAX_RUNS = 500;

export function findEndpoint(slug: string) {
  return getStore().workflows.find((w) => w.endpoint?.slug === slug);
}

import type { Outcome } from "./transfers";
const outcomeOf = (fired: string[]): Outcome => (fired.includes("block_transaction") ? "BLOCK" : fired.includes("challenge_customer") ? "CHALLENGE" : fired.includes("flag_for_review") ? "REVIEW" : "ALLOW");

function record(w: Workflow, r: { ms: number; ok: boolean; fired: string[]; error?: string; ref: string; decision: string }, viaEndpoint: boolean) {
  w.runs.push({ at: new Date().toISOString(), mode: "live", ...r });
  if (w.runs.length > MAX_RUNS) w.runs.splice(0, w.runs.length - MAX_RUNS);
  if (viaEndpoint && w.endpoint) { w.endpoint.calls++; w.endpoint.lastCallAt = new Date().toISOString(); }
}
async function sideEffects(w: Workflow, fired: string[], text: string) {
  const c = config().notification;
  if (fired.includes("send_alert")) {
    audit({ actor: `workflow:${w.id}`, entityType: "rule", entityId: w.id, action: "WORKFLOW_SEND_ALERT", before: {}, after: { text } });
    const jobs = [c.slack.enabled && slack(`⚡ ${w.name}: ${text}`), c.telegram.enabled && telegram(`⚡ ${w.name}: ${text}`)].filter(Boolean) as Promise<unknown>[];
    for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") console.warn("[fortify] workflow alert failed:", (r.reason as Error).message);
  }
}

// dryRun: evaluates exactly like a live call (same data, same workflow) but saves nothing and sends nothing.
export async function executeFlow(slug: string, body: Record<string, unknown>, dryRun = false) {
  const w = findEndpoint(slug);
  if (!w) throw new ApiError(404, "No workflow is published at this endpoint.", { code: "FLOW_NOT_FOUND" });
  if (!w.endpoint!.enabled) throw new ApiError(423, "This workflow endpoint is inactive.", { code: "FLOW_INACTIVE" });
  return runDeployed(w, body, dryRun, true);
}

// The workflow chosen to serve a built-in API: transaction_created → /api/transactions/score, login_attempt → /api/events/login,
// account_update → /api/events/account-update (Workflows → API → "Serve"). null = built-in pipeline.
export const API_OF = DEFAULT_ROUTE;
export type ServedTrigger = keyof typeof API_OF;
export const triggerOf = (w: Workflow) => { const def = deployed(w) ?? w; return (def.nodes.find((n) => n.type === "trigger")?.data as { event?: ServedTrigger } | undefined)?.event; };
// Each built-in route is served by its default workflow (role). If that workflow is not deployed, the built-in pipeline answers.
export function servingWorkflow(t: ServedTrigger) {
  const w = getStore().workflows.find((x) => x.role === t);
  return w && w.status === "Active" && deployed(w) && triggerOf(w) === t ? w : null;
}
export const servesApi = (w: Workflow) => w.role ?? null;

export async function runDeployed(w: Workflow, body: Record<string, unknown>, dryRun: boolean, viaEndpoint: boolean) {
  const def = w.status === "Active" ? deployed(w) : undefined;
  if (!def) throw new ApiError(423, "This workflow has no deployed version.", { code: "FLOW_NOT_DEPLOYED" });
  const trig = def.nodes.find((n) => n.type === "trigger")!.data as { event: string };
  const t0 = performance.now(), s = getStore(), actor = `workflow:${w.id}`;

  if (trig.event === "transaction_created") {
    const p = prepareTransfer(body as unknown as TransferInput), { c, ses, tx, hits } = p;
    const r = await runWorkflow(def, eventOf(s, tx, c, ses, hits), services());
    const fired = r.fired.map((f) => f.action), outcome = outcomeOf(fired);
    const result = { workflowId: w.id, version: w.deployedVersion, decision: DECISION[outcome], outcome, actions: fired, variables: r.variables, ms: +(performance.now() - t0).toFixed(1) };
    if (dryRun) return { ...result, dryRun: true, transactionStatus: ({ BLOCK: "DECLINED", CHALLENGE: "CHALLENGE_SENT", REVIEW: "HELD", ALLOW: "COMPLETED" } as const)[outcome], errors: r.errors };
    const done = commitOutcome(p, outcome, actor, { shadow: false, why: [`${w.id} v${w.deployedVersion}: ${fired.join(", ") || "no action"}`] });
    if (outcome === "ALLOW" && fired.includes("notify_user")) sendToCustomer(s, c, "released", tx).catch(() => {});
    sideEffects(w, fired, `${outcome} transfer ${tx.id} Rp ${tx.amount.toLocaleString("id-ID")} (${c.name})`).catch(() => {});
    record(w, { ms: result.ms, ok: !r.errors.length, fired, ...(r.errors[0] && { error: r.errors[0] }), ref: tx.id, decision: outcome }, viaEndpoint);
    const { alert, ...rest } = done; void alert;
    return { ...result, ...rest, ...transactionStatus(tx.id), decision: DECISION[outcome] };
  }

  // login_attempt / account_update
  const type = trig.event === "login_attempt" ? "login_attempt" : "account_update";
  const { c, e } = prepareEvent(type, body);  const r = await runWorkflow(def, eventFromRisk(s, e, c), services());
  // An Event score node in the workflow provides the stored score / reasons; otherwise the built-in event score stays.
  const sn = def.nodes.find((x) => x.type === "event_score") as { data: { output: string } } | undefined;
  if (sn && typeof r.variables[`${sn.data.output}_score`] === "number") Object.assign(e, { score: r.variables[`${sn.data.output}_score`], reasons: String(r.variables[`${sn.data.output}_reasons`] ?? "").split("; ").filter((x) => x && x !== "none") });
  const fired = r.fired.map((f) => f.action), outcome = outcomeOf(fired);
  const decision = outcome === "BLOCK" ? "DENY" : outcome === "ALLOW" ? "ALLOW" : "CHALLENGE";
  const result = { workflowId: w.id, version: w.deployedVersion, decision, actions: fired, variables: r.variables, score: e.score, reasons: e.reasons, ms: +(performance.now() - t0).toFixed(1) };
  if (dryRun) return { ...result, dryRun: true, errors: r.errors };
  Object.assign(e, { decision, reasons: [...e.reasons, `workflow ${w.id} v${w.deployedVersion}: ${fired.join(", ") || "no action"}`] });
  s.events.unshift(e);
  if (s.events.length > 5000) s.events.length = 5000;
  sideEffects(w, fired, `${decision} ${type.replace("_", " ")} for ${c.name}`).catch(() => {});
  if (fired.includes("notify_user")) {
    const bank = config().general.appName, what = e.change ? `your ${e.change}` : "your account";
    const text = type === "login_attempt" ? `${bank}: ${decision === "DENY" ? "we blocked a sign-in" : "new sign-in"} to your account${e.deviceId ? ` from ${e.deviceId}` : ""}. Not you? Call 14041.`
      : `${bank}: ${decision === "DENY" ? `we blocked a change to ${what}` : decision === "CHALLENGE" ? `a change to ${what} was requested and needs your verification` : `${what} was changed`}. Not you? Call 14041.`;
    sendNotice(s, c, text, e.id).catch(() => {});
  }
  record(w, { ms: result.ms, ok: !r.errors.length, fired, ...(r.errors[0] && { error: r.errors[0] }), ref: e.id, decision }, viaEndpoint);
  return { ...result, eventId: e.id, message: EVENT_MESSAGE[decision] };
}
