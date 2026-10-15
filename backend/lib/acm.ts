import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ALL_PERMS, REQUEST_TYPES, ROLE_PERMS, ROLES, roleOf, type Access, type AccessRequest, type Perm, type RequestType, type Role } from "./perms.ts";
import { USERNAME_RE, hasUser, hashPassword, putUser, removeUser } from "./auth.ts";

// Storage + maker-checker workflow for the permission tree in perms.ts (kept separate so client components can import the tree).
export * from "./perms.ts";

const SEED: Record<string, Perm[]> = {
  admin: ALL_PERMS,
  sari: ["dashboard.view", "alerts.view", "alerts.investigate", "alerts.decide", "rules.view", "rules.manage", "reports.view", "reports.export", "settings.view", "settings.maker"],
  supervisor: ["dashboard.view", "alerts.view", "rules.view", "rules.activate", "reports.view", "reports.export", "settings.view", "settings.checker"],
};
const DEFAULT: Perm[] = ["dashboard.view", "alerts.view"]; // new sign-ups: read-only until a checker grants more

// shortcut: JSON file rewritten on every change, fine for a handful of analysts; move to a database before production.
const FILE = join(/*turbopackIgnore: true*/ process.cwd(), "data", "runtime", "acm.json");
type Saved = { access: [string, Access][]; requests: AccessRequest[] };
const g = globalThis as unknown as { __fortifyAcm?: { access: Map<string, Access>; requests: AccessRequest[] } };
const db = (g.__fortifyAcm ??= (() => {
  try { if (existsSync(FILE)) { const s: Saved = JSON.parse(readFileSync(FILE, "utf8")); return { access: new Map(s.access), requests: s.requests }; } } catch {}
  return { access: new Map<string, Access>(), requests: [] };
})());
function save() {
  if (process.env.NODE_TEST_CONTEXT) return; // unit tests must not write the real file
  mkdirSync(join(FILE, ".."), { recursive: true });
  writeFileSync(FILE + ".tmp", JSON.stringify({ access: [...db.access], requests: db.requests } satisfies Saved)); renameSync(FILE + ".tmp", FILE);
}

const PROFILE: Record<string, { name: string; email: string }> = {
  admin: { name: "System Administrator", email: "admin@fortify.local" }, sari: { name: "Sari Wulandari", email: "sari@fortify.local" }, supervisor: { name: "Fraud Supervisor", email: "supervisor@fortify.local" },
};
export const getAccess = (u: string): Access => {
  const a = db.access.get(u) ?? { perms: [...(SEED[u] ?? DEFAULT)], active: true, ...PROFILE[u] };
  return { ...a, role: a.role ?? roleOf(a.perms) };
};
export const can = (u: string, perm: Perm | null) => { const a = getAccess(u); return a.active && (!perm || a.perms.includes(perm)); };
export const listRequests = () => [...db.requests].reverse().map((r) => pub(r));
export const pendingFor = (u: string) => db.requests.find((r) => r.target === u && r.status === "PENDING");

type Stored = AccessRequest & { passwordHash?: string };
const pub = ({ passwordHash, ...r }: Stored): AccessRequest => ({ ...r, type: r.type ?? "UPDATE_ACCESS", passwordReset: r.passwordReset ?? !!passwordHash });

export interface SubmitInput { type?: unknown; target?: unknown; perms?: unknown; active?: unknown; password?: unknown; name?: unknown; email?: unknown; role?: unknown }
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;

// Maker submits; nothing changes until a different user (checker) approves.
export function submitRequest(maker: string, b: SubmitInput): AccessRequest | string {
  const type = b.type as RequestType, target = typeof b.target === "string" ? b.target.trim().toLowerCase() : "";
  if (!REQUEST_TYPES.includes(type)) return "Unknown request type.";
  if (target === maker) return "You cannot change your own account.";
  if (pendingFor(target)) return `There is already a pending request for ${target}.`;
  const pw = typeof b.password === "string" && b.password ? b.password : null;
  if (pw !== null && pw.length < 8) return "Password must be at least 8 characters.";
  let before: Access | null = null, after: Access | null = null;
  if (type === "CREATE_USER") {
    if (!USERNAME_RE.test(target)) return "Username must be 3–32 characters: lowercase letters, digits, dots, hyphens, or underscores.";
    if (hasUser(target)) return "Username is already taken.";
    if (!pw) return "Set an initial password (at least 8 characters).";
  } else {
    if (!hasUser(target)) return "Unknown user.";
    before = getAccess(target);
  }
  if (type !== "DELETE_USER") {
    const role = (b.role ?? "CUSTOM") as Role;
    if (role !== "CUSTOM" && !ROLES.includes(role as never)) return "Role must be Admin, Operator, Viewer or Custom.";
    const perms = role === "CUSTOM" ? b.perms : ROLE_PERMS[role as (typeof ROLES)[number]];
    if (!Array.isArray(perms) || !perms.every((p) => ALL_PERMS.includes(p)) || typeof b.active !== "boolean") return "Invalid permissions.";
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "", email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!name) return "Full name is required.";
    if (!EMAIL.test(email) || email.length > 254) return "Enter a valid email address.";
    const clean = ALL_PERMS.filter((p) => (perms as string[]).includes(p));
    after = { perms: clean, active: b.active, name, email, role: role === "CUSTOM" ? roleOf(clean) : role };
  }
  if (type === "UPDATE_ACCESS" && !pw && before!.active === after!.active && before!.name === after!.name && before!.email === after!.email && before!.perms.length === after!.perms.length && after!.perms.every((p) => before!.perms.includes(p))) return "No changes to submit.";
  const r: Stored = { id: `ACR-${String(db.requests.length + 1).padStart(4, "0")}`, type, target, maker, createdAt: new Date().toISOString(), before, after, status: "PENDING", ...(pw && { passwordHash: hashPassword(pw), passwordReset: type === "UPDATE_ACCESS" }) };
  db.requests.push(r); save();
  return pub(r);
}

export function decideRequest(checker: string, id: string, approve: boolean, note?: string): AccessRequest | string {
  const r = db.requests.find((x) => x.id === id) as Stored | undefined;
  if (!r) return "Request not found.";
  if (r.status !== "PENDING") return "Request is already decided.";
  if (r.maker === checker) return "Maker and checker must be different users.";
  if (r.target === checker) return "You cannot approve a change to your own account.";
  const type = r.type ?? "UPDATE_ACCESS";
  if (approve && type === "CREATE_USER" && hasUser(r.target)) return "Username was taken after this request was made. Reject it instead.";
  if (approve && type !== "CREATE_USER" && !hasUser(r.target)) return "User no longer exists. Reject it instead.";
  Object.assign(r, { status: approve ? "APPROVED" : "REJECTED", checker, decidedAt: new Date().toISOString(), note: note?.slice(0, 500) || undefined });
  if (approve) {
    if (type === "DELETE_USER") { removeUser(r.target); db.access.delete(r.target); }
    else {
      db.access.set(r.target, r.after!);
      if (r.passwordHash) putUser(r.target, r.passwordHash);
    }
  }
  delete r.passwordHash; // not needed once decided
  save();
  return pub(r);
}
