import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// System configuration (Settings → General / API / Notification / Integration), persisted to data/runtime/settings.json.
// Secrets live only on the server: the browser sees "set" flags; an empty secret on save keeps the stored one.
import { LANGUAGES, TIMEZONES } from "./settings-shared.ts";
export { LANGUAGES, TIMEZONES };

export interface Config {
  general: { appName: string; timezone: keyof typeof TIMEZONES; language: keyof typeof LANGUAGES; minAmount: number; maxVelocity: number; geoRadiusKm: number; autoResolveHours: number; highValueAmount: number };
  api: { webhookUrl: string; webhookSecret: string; webhookEvents: { alertCreated: boolean; alertResolved: boolean }; requireApiKey: boolean };
  notification: {
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
    slack: { webhookUrl: string; enabled: boolean };
    telegram: { botToken: string; chatId: string; enabled: boolean };
    minSeverity: "MEDIUM" | "HIGH" | "CRITICAL"; // new alerts at or above this go to the enabled channels
  };
  // Messages to customers (OTP challenge, decision notices). Providers are generic HTTP so any SMS / push gateway fits.
  customer: {
    sms: { enabled: boolean; url: string; authHeader: string; body: string };
    push: { enabled: boolean; url: string; authHeader: string; body: string };
    otpMinutes: number; otpAttempts: number;
    templates: { challenge: string; declined: string; frozen: string; released: string };
  };
  // Gemini for every AI layer (investigation Assistant, rule generator, builder chat, workflow AI node, dashboard chat).
  ai: { mode: "api_key" | "vertex"; baseUrl: string; apiKey: string; project: string; location: string; model: string };
  integration: {
    firestore: { projectId: string; databaseId: string; serviceAccountJson: string };
    endpoints: { name: string; url: string }[];
    grafana: { lokiUrl: string; user: string; apiKey: string; enabled: boolean };
  };
}
export interface ApiKey { id: string; name: string; prefix: string; last4: string; hash: string; createdAt: string; createdBy: string; status: "ACTIVE" | "REVOKED"; revokedAt?: string; lastUsedAt?: string }

const SECRETS = [["customer", "sms", "authHeader"], ["customer", "push", "authHeader"], ["ai", "apiKey"], ["api", "webhookSecret"], ["notification", "smtp", "pass"], ["notification", "slack", "webhookUrl"], ["notification", "telegram", "botToken"], ["integration", "firestore", "serviceAccountJson"], ["integration", "grafana", "apiKey"]] as const;

export const DEFAULTS = (): Config => ({
  general: { appName: "FraudSight AI", timezone: "Asia/Jakarta", language: "en", minAmount: 10_000_000, maxVelocity: 5, geoRadiusKm: 500, autoResolveHours: 0, highValueAmount: 100_000_000 },
  api: { webhookUrl: "", webhookSecret: "", webhookEvents: { alertCreated: true, alertResolved: false }, requireApiKey: false },
  notification: { smtp: { host: "", port: 587, secure: false, user: "", pass: "", from: "FraudSight AI Alerts <alerts@fraudsight.local>" }, slack: { webhookUrl: "", enabled: false }, telegram: { botToken: "", chatId: "", enabled: false }, minSeverity: "HIGH" },
  customer: {
    sms: { enabled: false, url: "", authHeader: "", body: '{ "to": "{{phone}}", "text": "{{text}}" }' },
    push: { enabled: false, url: "", authHeader: "", body: '{ "customerId": "{{customerId}}", "title": "{{bank}}", "body": "{{text}}" }' },
    otpMinutes: 5, otpAttempts: 3,
    templates: {
      challenge: "{{bank}}: your verification code for the Rp {{amount}} transfer to {{beneficiary}} is {{otp}}. Valid for {{minutes}} minutes. NEVER share this code with anyone.",
      declined: "{{bank}}: we cancelled your Rp {{amount}} transfer to {{beneficiary}} for your security. If this was you, call 14041.",
      frozen: "{{bank}}: your account has been temporarily secured because of suspicious activity. Please call 14041.",
      released: "{{bank}}: your Rp {{amount}} transfer to {{beneficiary}} has been processed.",
    },
  },
  ai: { mode: "api_key", baseUrl: "", apiKey: "", project: "", location: "global", model: "gemini-3.5-flash-lite" },
  integration: { firestore: { projectId: "", databaseId: "(default)", serviceAccountJson: "" }, endpoints: [], grafana: { lokiUrl: "", user: "", apiKey: "", enabled: false } },
});

const FILE = join(/*turbopackIgnore: true*/ process.cwd(), "data", "runtime", "settings.json");
type Saved = { config: Config; apiKeys: ApiKey[] };
const g = globalThis as unknown as { __fortifySettings?: Saved };
const merge = <T>(base: T, over: unknown): T => {
  if (!over || typeof over !== "object" || Array.isArray(base) || typeof base !== "object" || base === null) return (over ?? base) as T;
  return Object.fromEntries(Object.entries(base as object).map(([k, v]) => [k, k in (over as object) ? merge(v, (over as Record<string, unknown>)[k]) : v])) as T;
};
const db = (g.__fortifySettings ??= (() => {
  try { if (existsSync(FILE)) { const s = JSON.parse(readFileSync(FILE, "utf8")) as Saved; return { config: merge(DEFAULTS(), s.config), apiKeys: s.apiKeys ?? [] }; } } catch {}
  return { config: DEFAULTS(), apiKeys: [] };
})());
db.config = merge(DEFAULTS(), db.config); // config loaded before a new section existed (file or hot reload) gets its defaults
// Templates still on the old Indonesian defaults move to the English ones (customised templates are left alone).
for (const k of ["challenge", "declined", "frozen", "released"] as const) if (/kode verifikasi|kami batalkan|sementara kami amankan|telah diproses/.test(db.config.customer.templates[k])) db.config.customer.templates[k] = DEFAULTS().customer.templates[k];
function save() {
  if (process.env.NODE_TEST_CONTEXT) return;
  mkdirSync(join(FILE, ".."), { recursive: true });
  writeFileSync(FILE + ".tmp", JSON.stringify(db), { mode: 0o600 }); renameSync(FILE + ".tmp", FILE); // holds secrets: owner-only
}

export const config = () => db.config;
const at = (o: unknown, path: readonly string[]) => path.reduce((x, k) => (x as Record<string, unknown>)?.[k], o);
const put = (o: unknown, path: readonly string[], v: unknown) => { const parent = at(o, path.slice(0, -1)) as Record<string, unknown>; parent[path[path.length - 1]] = v; };

// What the browser gets: secrets replaced by "" plus a list of which ones are set.
export function publicConfig() {
  const c = structuredClone(db.config), set: string[] = [];
  for (const p of SECRETS) { if (at(c, p)) set.push(p.join(".")); put(c, p, ""); }
  return { config: c, secretsSet: set };
}

const isUrl = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; } };
const num = (v: unknown, min: number, max: number) => Number.isFinite(v) && (v as number) >= min && (v as number) <= max;

// Validates one section and stores it. Empty secret fields keep the current value; "clear" lists secrets to remove.
export function updateSection(section: keyof Config, raw: unknown, clear: string[] = []): string | null {
  if (!(section in db.config)) return "Unknown settings section.";
  const next = merge(structuredClone(db.config[section]), raw) as Config[typeof section];
  for (const p of SECRETS) if (p[0] === section) {
    const v = at({ [section]: next }, p);
    if (clear.includes(p.join("."))) put({ [section]: next }, p, "");
    else if (!v) put({ [section]: next }, p, at(db.config, p));
  }
  const e = check(section, next);
  if (e) return e;
  (db.config as unknown as Record<string, unknown>)[section] = next; save();
  return null;
}

function check(section: keyof Config, v: Config[keyof Config]): string | null {
  if (section === "general") {
    const x = v as Config["general"];
    if (!x.appName?.trim() || x.appName.length > 40) return "App name is required (max 40 characters).";
    if (!(x.timezone in TIMEZONES)) return "Unsupported timezone.";
    if (!(x.language in LANGUAGES)) return "Unsupported language.";
    if (!num(x.minAmount, 0, 1e13) || !num(x.maxVelocity, 1, 1000) || !num(x.geoRadiusKm, 1, 20000)) return "Thresholds must be positive numbers (velocity 1–1000, radius 1–20000 km).";
    if (!Number.isInteger(x.autoResolveHours) || !num(x.autoResolveHours, 0, 720)) return "Auto-resolve must be 0 (off) to 720 hours.";
    if (!num(x.highValueAmount, 0, 1e15)) return "High-value threshold must be 0 (off) or a positive amount.";
  }
  if (section === "api") {
    const x = v as Config["api"];
    if (x.webhookUrl && !isUrl(x.webhookUrl)) return "Webhook URL must start with http:// or https://.";
    if (typeof x.requireApiKey !== "boolean") return "Invalid API key setting.";
  }
  if (section === "notification") {
    const x = v as Config["notification"];
    if (x.smtp.host && !/^[a-z0-9.-]+$/i.test(x.smtp.host)) return "SMTP host must be a hostname.";
    if (!num(x.smtp.port, 1, 65535)) return "SMTP port must be 1–65535.";
    if (/[\r\n]/.test(x.smtp.from) || /[\r\n]/.test(x.smtp.user)) return "SMTP fields cannot contain line breaks.";
    if (x.slack.webhookUrl && !/^https:\/\/hooks\.slack\.com\//.test(x.slack.webhookUrl)) return "Slack webhook must be an https://hooks.slack.com/… URL.";
    if (x.telegram.botToken && !/^\d+:[\w-]{20,}$/.test(x.telegram.botToken)) return "Telegram bot token looks wrong (expected 123456:ABC…).";
    if (x.telegram.chatId && !/^-?\d+$|^@\w{4,}$/.test(x.telegram.chatId)) return "Telegram chat ID must be a number or @channel.";
    if (!["MEDIUM", "HIGH", "CRITICAL"].includes(x.minSeverity)) return "Invalid minimum severity.";
  }
  if (section === "customer") {
    const x = v as Config["customer"];
    for (const [k, ch] of [["SMS", x.sms], ["Push", x.push]] as const) {
      if (ch.url && !isUrl(ch.url)) return `${k} URL must start with http:// or https://.`;
      if (ch.enabled && !ch.url) return `${k} is enabled but has no URL.`;
      if (/[\r\n]/.test(ch.authHeader)) return `${k} auth header cannot contain line breaks.`;
      if (ch.body.length > 2000) return `${k} body template is too long.`;
    }
    if (!Number.isInteger(x.otpMinutes) || x.otpMinutes < 1 || x.otpMinutes > 30) return "OTP validity must be 1–30 minutes.";
    if (!Number.isInteger(x.otpAttempts) || x.otpAttempts < 1 || x.otpAttempts > 10) return "OTP attempts must be 1–10.";
    if (!x.templates.challenge.includes("{{otp}}")) return "The challenge template must contain {{otp}}.";
    if (Object.values(x.templates).some((t) => !t.trim() || t.length > 500)) return "Every message template is required (max 500 characters).";
  }
  if (section === "ai") {
    const x = v as Config["ai"];
    if (x.mode !== "api_key" && x.mode !== "vertex") return "Connection must be API key or Vertex AI.";
    if (x.baseUrl && !isUrl(x.baseUrl)) return "Base URL must start with http:// or https://.";
    if (!/^[\w.-]{3,60}$/.test(x.model)) return "Model name looks wrong (e.g. gemini-2.5-flash).";
    if (x.mode === "vertex" && x.project && !/^[a-z][a-z0-9-]{4,29}$/.test(x.project)) return "Google Cloud project ID looks wrong.";
    if (!/^[a-z0-9-]{2,30}$/.test(x.location)) return "Location looks wrong (e.g. global, us-central1, asia-southeast2).";
    if (/[\r\n\s]/.test(x.apiKey)) return "API key cannot contain spaces or line breaks.";
  }
  if (section === "integration") {
    const x = v as Config["integration"];
    if (x.firestore.projectId && !/^[a-z][a-z0-9-]{4,29}$/.test(x.firestore.projectId)) return "Firestore project ID looks wrong.";
    if (x.firestore.serviceAccountJson) { try { const j = JSON.parse(x.firestore.serviceAccountJson); if (!j.client_email || !j.private_key) throw 0; } catch { return "Service account must be the JSON key file (with client_email and private_key)."; } }
    if (!Array.isArray(x.endpoints) || x.endpoints.length > 20 || x.endpoints.some((e) => !e?.name?.trim() || !isUrl(e.url))) return "Each external endpoint needs a name and an http(s) URL (max 20).";
    if (x.grafana.lokiUrl && !isUrl(x.grafana.lokiUrl)) return "Loki URL must start with http:// or https://.";
  }
  return null;
}

// API keys for the internet-banking channel. Only a SHA-256 hash is stored; the full key is shown once at creation.
const sha = (k: string) => createHash("sha256").update(k).digest("hex");
export const listKeys = () => db.apiKeys.map(({ hash, ...k }) => k); // eslint-disable-line @typescript-eslint/no-unused-vars
export function createKey(name: string, by: string) {
  const key = `fk_live_${randomBytes(24).toString("base64url")}`;
  const k: ApiKey = { id: `key_${randomBytes(4).toString("hex")}`, name: name.trim().slice(0, 60), prefix: key.slice(0, 12), last4: key.slice(-4), hash: sha(key), createdAt: new Date().toISOString(), createdBy: by, status: "ACTIVE" };
  db.apiKeys.push(k); save();
  return { key, record: listKeys().find((x) => x.id === k.id)! };
}
export function revokeKey(id: string) {
  const k = db.apiKeys.find((x) => x.id === id);
  if (!k) return "API key not found.";
  if (k.status === "REVOKED") return "Already revoked.";
  k.status = "REVOKED"; k.revokedAt = new Date().toISOString(); save();
  return null;
}
export function verifyKey(key: string | null) {
  if (!key) return false;
  const h = Buffer.from(sha(key));
  const k = db.apiKeys.find((x) => x.status === "ACTIVE" && timingSafeEqual(Buffer.from(x.hash), h));
  if (k) k.lastUsedAt = new Date().toISOString(); // in memory; persisted with the next save
  return !!k;
}
