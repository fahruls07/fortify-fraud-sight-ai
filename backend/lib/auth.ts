import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE = "fortify_session";
const TTL = 8 * 3600; // one analyst shift, seconds

if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET) throw new Error("AUTH_SECRET must be set in production");
const SECRET = process.env.AUTH_SECRET ?? "fortify-dev-secret"; // dev-only fallback; production refuses to start without AUTH_SECRET

const sig = (v: string) => createHmac("sha256", SECRET).update(v).digest("base64url");

// Cookie value: `<username>.<expiry-epoch-s>.<hmac>`. Stateless, so it survives dev reloads and needs no session table.
export function signSession(username: string, now = Date.now()) {
  const v = `${username}.${Math.floor(now / 1000) + TTL}`;
  return { value: `${v}.${sig(v)}`, maxAge: TTL };
}

export function verifySession(token: string | undefined, now = Date.now()): string | null {
  const parts = token?.split(".") ?? [];
  const mac = parts.pop(), exp = parts.pop(), user = parts.join("."); // username may itself contain dots
  if (!user || !exp || !mac) return null;
  const want = Buffer.from(sig(`${user}.${exp}`)), got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return Number(exp) * 1000 > now ? user : null;
}

const hash = (pw: string, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
const check = (pw: string, stored: string) => {
  const [salt, h] = stored.split(":");
  return timingSafeEqual(Buffer.from(h, "hex"), scryptSync(pw, salt, 32));
};

// Users (seeded dummies + sign-ups) and login times persist to data/runtime/users.json.
// shortcut: JSON file rewritten on every change, fine for a handful of analysts; move to a real user store before production.
const FILE = join(/*turbopackIgnore: true*/ process.cwd(), "data", "runtime", "users.json");
type Saved = { users: [string, string][]; logins: [string, { prev: string | null; now: string }][] };
const loaded: Saved | null = (() => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null; } catch { return null; } })();
const g = globalThis as unknown as { __fortifyUsers?: Map<string, string>; __fortifyLogins?: Map<string, { prev: string | null; now: string }> };
const users = (g.__fortifyUsers ??= new Map(loaded?.users ?? []));
// Demo accounts always exist (also when users.json predates them). supervisor is the default checker for maker-checker.
for (const [u, pw] of [["sari", "fortify123"], ["admin", "admin12345"], ["supervisor", "super12345"]]) if (!users.has(u)) users.set(u, hash(pw));
const logins = (g.__fortifyLogins ??= new Map(loaded?.logins ?? []));
function save() {
  if (process.env.NODE_TEST_CONTEXT) return; // unit tests must not write the real users file
  mkdirSync(join(FILE, ".."), { recursive: true });
  writeFileSync(FILE + ".tmp", JSON.stringify({ users: [...users], logins: [...logins] } satisfies Saved)); renameSync(FILE + ".tmp", FILE);
}

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function login(username: string, password: string) {
  const stored = users.get(username.trim().toLowerCase());
  const ok = !!stored && check(password, stored);
  if (ok) { const u = username.trim().toLowerCase(), l = logins.get(u); logins.set(u, { prev: l?.now ?? null, now: new Date().toISOString() }); save(); }
  return ok;
}

// "Last login" shown in the account menu = the login before the current one (null on first login).
export const listUsers = () => [...users.keys()].sort();
export const lastLogin = (u: string) => logins.get(u)?.prev ?? null;

// Used by the maker-checker workflow (acm.ts) once a checker approves; the password is hashed at submit time.
export const hashPassword = (pw: string) => hash(pw);
export const hasUser = (u: string) => users.has(u);
export function putUser(u: string, passwordHash: string) { users.set(u, passwordHash); save(); }
export function removeUser(u: string) { users.delete(u); logins.delete(u); save(); }

// Returns an error message, or null when the account was created.
export function register(username: string, password: string, confirm: string): string | null {
  const u = username.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return "Username must be 3–32 characters: lowercase letters, digits, dots, hyphens, or underscores.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirm) return "Passwords do not match.";
  if (users.has(u)) return "Username is already taken.";
  users.set(u, hash(password));
  save();
  return null;
}

export function sessionCookie(username: string) {
  const s = signSession(username.trim().toLowerCase());
  return `${COOKIE}=${s.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${s.maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

// Logged-in username for API routes (proxy already rejects unauthenticated /api calls).
export const userFrom = (req: Request) => verifySession(req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))?.[1]) ?? "unknown";
