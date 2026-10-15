import { audit } from "./auditlog.ts";
import { metrics, type Workflow } from "./workflows.ts";

// List view: everything except the heavy version / run arrays.
export const summary = (w: Workflow) => {
  const { versions, runs, nodes, edges, ...rest } = w; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, nodes: nodes.length, metrics: metrics(runs) };
};
export const detail = (w: Workflow) => ({ ...w, runs: w.runs.slice(-50).reverse(), metrics: metrics(w.runs) });
export const log = (actor: string, w: Workflow, action: string, after: object = {}) =>
  audit({ actor, entityType: "rule", entityId: w.id, action, before: {}, after: { name: w.name, version: w.version, ...after } });
