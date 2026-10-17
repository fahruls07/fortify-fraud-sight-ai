// Access Control Management: a permission tree (menu → actions) per user, changed only through maker-checker requests.
export const PERM_TREE = [
  { key: "dashboard", label: "Command Center", children: [{ key: "dashboard.view", label: "View dashboard" }] },
  { key: "alerts", label: "Alerts", children: [
    { key: "alerts.view", label: "View alerts & customers" },
    { key: "alerts.investigate", label: "Run Assistant investigation" },
    { key: "alerts.decide", label: "Decide alerts (approve / decline / freeze)" },
  ] },
  { key: "rules", label: "Rule Builder", children: [
    { key: "rules.view", label: "View rules" },
    { key: "rules.manage", label: "Create, edit & delete rules" },
    { key: "rules.activate", label: "Activate / deactivate rules" },
  ] },
  { key: "cases", label: "Cases", children: [
    { key: "cases.view", label: "View cases, notes & attachments" },
    { key: "cases.manage", label: "Create / update cases, add notes & files, assign alerts" },
  ] },
  { key: "intel", label: "Risk Intelligence", children: [
    { key: "intel.view", label: "View watchlists, AML lists, events & customer messages" },
    { key: "intel.manage", label: "Edit watchlists and AML lists" },
  ] },
  { key: "reports", label: "Fraud Report", children: [
    { key: "reports.view", label: "View reports" },
    { key: "reports.export", label: "Export to Excel" },
  ] },
  { key: "settings", label: "Settings & Approval Center", children: [
    { key: "settings.view", label: "View users, access & audit" },
    { key: "settings.maker", label: "Maker: submit access changes" },
    { key: "settings.checker", label: "Checker: approve / reject changes" },
    { key: "settings.config", label: "Edit system configuration (general, API, notifications, integrations)" },
  ] },
] as const;
export type Perm = (typeof PERM_TREE)[number]["children"][number]["key"];
export const LABEL = Object.fromEntries(PERM_TREE.flatMap((g) => g.children.map((c) => [c.key, `${g.label}: ${c.label}`]))) as Record<Perm, string>;
export const ALL_PERMS = PERM_TREE.flatMap((g) => g.children.map((c) => c.key)) as Perm[];

// Which permission a request needs. null = any logged-in user (e.g. /api/me).
export function requiredPerm(method: string, path: string, search = ""): Perm | null {
  const write = method !== "GET" && method !== "HEAD";
  const p = (s: string) => path === s || path.startsWith(s + "/");
  if (p("/api/alerts") && /\/decision$/.test(path)) return "alerts.decide";
  if (p("/api/alerts") && /\/assign$/.test(path)) return "cases.manage";
  if (p("/cases") || p("/api/cases") || p("/api/notes") || p("/api/attachments")) return write ? "cases.manage" : "cases.view";
  if (p("/api/intel/aml/screen")) return "intel.view"; // read-only lookup
  if (p("/intel") || p("/api/intel")) return write ? "intel.manage" : "intel.view";
  if (p("/api/alerts") && /\/investigate$/.test(path)) return "alerts.investigate";
  if (p("/api/copilot/chat")) return "dashboard.view"; // read-only dashboard assistant
  if (p("/api/copilot")) return "rules.manage"; // builder chat creates rules / workflows
  if (p("/api/graphql")) return "alerts.view"; // mutations re-check their own permission in the resolver
  if (["/alerts", "/customers", "/devices", "/sessions", "/graph", "/investigator", "/feedback", "/api/alerts", "/api/customers", "/api/accounts", "/api/sessions", "/api/devices", "/api/search", "/api/feedback", "/api/investigations", "/api/kb"].some(p)) return "alerts.view";
  if (p("/api/rules") && /\/(de)?activate$/.test(path)) return "rules.activate";
  if (p("/api/workflows") && /\/(deploy|publish|unpublish|endpoint-on|endpoint-off|scoring-on|scoring-off)$/.test(path)) return "rules.activate";
  if (p("/api/workflows") && /\/try$/.test(path)) return "rules.view"; // dry run, changes nothing
  if (p("/workflows") || p("/api/workflows")) return write && !/\/test$/.test(path) ? "rules.manage" : "rules.view"; // test run changes nothing
  if (p("/rules/new") || p("/workflows/new") || (p("/api/rules") && write)) return "rules.manage";
  if (p("/rules") || p("/api/rules")) return "rules.view";
  if (p("/api/reports") && (write || /(^|&|\?)format=(xls|csv|xml)/.test(search))) return "reports.export"; // downloads, email, schedules
  if (p("/reports") || p("/api/reports")) return "reports.view";
  if (p("/api/settings/requests") && /\/(approve|reject)$/.test(path)) return "settings.checker";
  if (p("/api/settings/config") || p("/api/settings/apikeys")) return write ? "settings.config" : "settings.view";
  if (p("/api/settings") && write) return "settings.maker";
  if (p("/settings") || p("/approvals") || p("/api/settings") || p("/api/audit")) return "settings.view";
  if (p("/api/demo")) return "settings.config"; // demo controls are admin-only: refresh / reset / fallback / simulate
  if (path === "/" || p("/api/dashboard")) return "dashboard.view";
  return null;
}

export const ROLES = ["ADMIN", "OPERATOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number] | "CUSTOM";
export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", OPERATOR: "Operator", VIEWER: "Viewer", CUSTOM: "Custom" };
// Role presets. CUSTOM = permissions picked by hand in the tree.
export const ROLE_PERMS: Record<(typeof ROLES)[number], Perm[]> = {
  ADMIN: PERM_TREE.flatMap((g) => g.children.map((c) => c.key)) as Perm[],
  OPERATOR: ["dashboard.view", "alerts.view", "alerts.investigate", "alerts.decide", "rules.view", "rules.manage", "cases.view", "cases.manage", "intel.view", "reports.view", "reports.export"],
  VIEWER: ["dashboard.view", "alerts.view", "rules.view", "cases.view", "intel.view", "reports.view"],
};
export const roleOf = (perms: Perm[]): Role => ROLES.find((r) => ROLE_PERMS[r].length === perms.length && ROLE_PERMS[r].every((p) => perms.includes(p))) ?? "CUSTOM";
export interface Access { perms: Perm[]; active: boolean; name?: string; email?: string; role?: Role }
export const REQUEST_TYPES = ["CREATE_USER", "UPDATE_ACCESS", "DELETE_USER"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export interface AccessRequest {
  id: string; type: RequestType; target: string; maker: string; createdAt: string; before: Access | null; after: Access | null;
  passwordReset?: boolean; // the hash itself never leaves the server
  status: "PENDING" | "APPROVED" | "REJECTED"; checker?: string; decidedAt?: string; note?: string;
}
