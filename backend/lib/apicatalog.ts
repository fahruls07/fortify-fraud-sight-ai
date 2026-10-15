import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { requiredPerm } from "./perms.ts";

// OpenAPI 3 document for every console API, built from app/api/**/route.ts so it never drifts from the code.
// Summaries come from the comment above each handler (or the file's first comment).
const ROOT = join(/*turbopackIgnore: true*/ process.cwd(), "app", "api");
const METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
// One-line summaries; routes not listed fall back to their code comment.
const SUMMARY: Record<string, string> = {"GET /api/accounts": "Beneficiary accounts that have a connections graph, riskiest first", "GET /api/search": "Investigator: search customers, accounts, alerts, cases, devices, sessions, transactions, IPs", "GET /api/customers": "Customer profiles list with risk and activity", "GET /api/customers/{id}/profile": "Full customer profile: risk, transactions, alerts, cases, sessions, beneficiaries, devices, timeline", "GET /api/devices": "Device intelligence: devices with risk, sessions, customers", "GET /api/devices/{id}": "Device detail with its sessions and customers", "GET /api/sessions/{id}/detail": "Session view: alerts, fired rules, reason codes, sanctions, IP, device and behaviour biometrics", "GET /api/feedback": "Analyst feedback (labels) with agreement stats", "GET /api/accounts/{id}/graph": "Connections graph and timeline of a beneficiary account (from transaction history)", "GET /api/intel/watchlist": "List blacklist / whitelist entries", "POST /api/intel/watchlist": "Add a blacklist / whitelist entry (account, beneficiary, device, IP)", "DELETE /api/intel/watchlist/{id}": "Remove a watchlist entry", "GET /api/intel/aml": "List AML screening entries (sanctions, PEP, internal)", "POST /api/intel/aml": "Add an AML screening entry", "DELETE /api/intel/aml/{id}": "Remove an AML entry", "POST /api/intel/aml/screen": "Screen a name against the AML lists", "GET /api/intel/events": "Login / account-update events (filters: type, decision)", "GET /api/intel/messages": "Messages sent to customers (SMS / push / outbox)", "GET /api/cases": "List cases", "POST /api/cases": "Create a case from alerts", "GET /api/cases/{id}": "Case with its alerts and timeline", "PUT /api/cases/{id}": "Update status, priority, assignee or title (closing needs a resolution)", "POST /api/cases/{id}/alerts": "Merge alerts into a case", "GET /api/notes": "Notes on an alert or case (entity)", "POST /api/notes": "Add a note to an alert or case", "GET /api/attachments": "Attachments of an alert or case", "POST /api/attachments": "Upload an attachment (multipart, ≤ 5 MB)", "GET /api/attachments/{id}": "Download an attachment", "POST /api/alerts/{id}/assign": "Assign / reassign an alert", "GET /api/rules/performance": "Rule hits, precision, recall and tuning suggestions", "GET /api/users": "Active users for assignee pickers",  "GET /api/accounts/{id}/network": "Account link graph (shared devices, mule network)", "POST /api/alerts/{id}/decision": "Decide an alert: APPROVE, CHALLENGE, DECLINE or DECLINE_AND_FREEZE", "POST /api/alerts/{id}/investigate": "Start an AI Assistant investigation", "GET /api/alerts/{id}": "Alert detail with its transaction and latest investigation", "GET /api/alerts": "Alert queue (filters: status, risk)", "GET /api/alerts/stream": "Live alert events (Server-Sent Events)", "GET /api/audit": "Audit log (filter: entityId)", "POST /api/auth/login": "Sign in; sets the session cookie", "POST /api/auth/logout": "Sign out", "POST /api/auth/register": "Create an account (read-only access until approved)", "POST /api/copilot/build": "Rule / Workflow Assistant chat: proposes a definition", "POST /api/copilot/chat": "Dashboard AI assistant (read-only)", "GET /api/customers/{id}": "Customer 360 profile", "GET /api/customers/{id}/transactions": "Customer transactions (limit)", "GET /api/dashboard/overview": "Command Center numbers (range, severity, status)", "GET /api/demo/fallback": "Demo: AI fallback-only switch state", "POST /api/demo/fallback": "Demo: toggle AI fallback-only mode", "POST /api/demo/reset": "Demo: reset all data to the seed", "POST /api/demo/simulate/budi": "Demo: simulate the screen-sharing scam transfer", "GET /api/graphql": "GraphQL subscriptions over SSE / GraphiQL", "POST /api/graphql": "GraphQL queries and mutations (alerts)", "GET /api/investigations/{id}": "Investigation result and trace", "GET /api/investigations/{id}/stream": "Live investigation steps (SSE)", "GET /api/kb/{docId}": "Knowledge-base playbook", "GET /api/openapi": "This API reference (HTML) or the banking spec (YAML)", "POST /api/reports/email": "Email a report", "GET /api/reports": "Fraud report data, or a CSV / Excel download (format)", "DELETE /api/reports/schedules/{id}": "Delete a report schedule", "POST /api/reports/schedules/{id}/run": "Send a scheduled report now", "GET /api/reports/schedules": "List report schedules", "POST /api/reports/schedules": "Create a daily / weekly / monthly report schedule", "POST /api/rules/{id}/activate": "Activate a rule", "POST /api/rules/{id}/backtest": "Backtest a rule on the last 30 days", "POST /api/rules/{id}/deactivate": "Deactivate a rule", "GET /api/rules/{id}": "Get a rule", "PUT /api/rules/{id}": "Update a rule (moves it back to Draft)", "DELETE /api/rules/{id}": "Delete a Draft rule", "GET /api/rules/export": "Export rules as a .zip package (ids)", "POST /api/rules/generate": "Generate a rule from a sentence (AI)", "POST /api/rules/import": "Import rules from a .zip (preview, then selected files)", "GET /api/rules": "List rules", "POST /api/rules": "Create a rule", "GET /api/sessions/{id}/signals": "Session device and behaviour signals", "POST /api/settings/apikeys/{id}/revoke": "Revoke an API key", "GET /api/settings/apikeys": "List API keys (masked)", "POST /api/settings/apikeys": "Generate an API key (shown once)", "GET /api/settings/config": "System configuration (secrets hidden)", "PUT /api/settings/config": "Save one configuration section", "POST /api/settings/config/test": "Test an integration (SMTP, Slack, Telegram, webhook, Firestore, Grafana, Gemini, endpoint)", "POST /api/settings/requests/{id}/{decision}": "Checker: approve or reject an access request", "GET /api/settings/requests": "Maker-checker access requests", "POST /api/settings/requests": "Maker: request a user create / edit / delete / password reset", "GET /api/settings/users": "Users with role, status and last login", "POST /api/workflows/{id}/{op}": "Workflow deploy / archive / restore / rollback / test", "GET /api/workflows/{id}": "Workflow with versions, recent runs and metrics", "PUT /api/workflows/{id}": "Save a workflow (new version)", "DELETE /api/workflows/{id}": "Delete a non-active workflow", "GET /api/workflows": "List workflows with metrics", "POST /api/workflows": "Create a workflow" };
const PUBLIC = [/^\/api\/auth\//, /^\/api\/transactions\//, /^\/api\/demo\//, /^\/api\/openapi/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : f === "route.ts" ? [p] : []; });
}
const comment = (src: string, at: number) => {
  const before = src.slice(0, at).split("\n").reverse();
  const lines: string[] = [];
  for (const l of before.slice(1)) { const m = l.match(/^\s*\/\/\s?(.*)$/); if (m) lines.unshift(m[1]); else if (l.trim()) break; }
  return lines.join(" ").trim();
};

export function consoleSpec() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const f of files(ROOT).sort()) {
    const src = readFileSync(f, "utf8");
    const route = "/api/" + relative(ROOT, f).split(sep).slice(0, -1).join("/");
    const path = route.replace(/\[([^\]]+)\]/g, "{$1}");
    if (path.startsWith("/api/transactions/") || path.startsWith("/api/events/") || path.startsWith("/api/flows/")) continue; // documented in the banking spec
    const fileDoc = src.match(/^\s*\/\/\s?(.+)$/m)?.[1] ?? "";
    const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const tag = path.split("/")[2];
    for (const m of METHODS) {
      const re = new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+${m}\\b|const\\s+${m}\\b)|export\\s*\\{[^}]*\\bas\\s+${m}\\b`);
      const hit = re.exec(src);
      if (!hit) continue;
      const desc = comment(src, hit.index) || fileDoc;
      const isPublic = PUBLIC.some((p) => p.test(path)), perm = requiredPerm(m, path.replace(/\{[^}]+\}/g, "x"));
      (paths[path] ??= {})[m.toLowerCase()] = {
        tags: [tag], summary: SUMMARY[`${m} ${path}`] ?? (desc.split(/(?<=\.)\s/)[0].slice(0, 120) || `${m} ${path}`), ...(desc && { description: desc }),
        ...(params.length && { parameters: params }),
        ...(m !== "GET" && { requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }),
        ...(isPublic ? { security: [] } : {}),
        "x-permission": isPublic ? "public" : perm ?? "any signed-in user",
        responses: { 200: { description: "OK" }, 400: { description: "Invalid input ({ error })" }, ...(isPublic ? {} : { 401: { description: "Not signed in" }, 403: { description: `Missing permission${perm ? ` ${perm}` : ""}` } }) },
      };
    }
  }
  return {
    openapi: "3.0.3",
    info: { title: "Fortify Console API", version: "1.0.0", description: "Every API used by the Fortify console, generated from the route files. Calls need a console session (sign in first; the browser sends the cookie). Each operation lists the permission it needs under x-permission. The internet-banking endpoints are in the other spec." },
    servers: [{ url: "/" }],
    security: [{ session: [] }],
    components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "fortify_session" } } },
    tags: [...new Set(Object.keys(paths).map((p) => p.split("/")[2]))].sort().map((name) => ({ name })),
    paths,
  };
}
