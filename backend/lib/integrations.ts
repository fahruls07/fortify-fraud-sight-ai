import { createHmac, createSign } from "node:crypto";
import { config } from "./settings.ts";
import { sendMail } from "./mailer.ts";
import { subscribe, type AlertRow } from "./alerts.ts";
import { idr } from "./format.ts";
import { generate, geminiConfigured, geminiInfo } from "./copilot/gemini.ts";

// Outbound calls use admin-configured URLs only, with a hard timeout. Results are short, human-readable strings.
export type TestResult = { ok: boolean; message: string; ms: number };
const TIMEOUT = 6000;
async function timed(fn: () => Promise<string>): Promise<TestResult> {
  const t0 = Date.now();
  try { return { ok: true, message: await fn(), ms: Date.now() - t0 }; }
  catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const why = err.name === "TimeoutError" ? `Timed out after ${TIMEOUT / 1000}s` : err.cause ? `Cannot connect (${err.cause.code ?? err.cause.message})` : err.message;
    return { ok: false, message: why, ms: Date.now() - t0 };
  }
}
const go = (url: string, init: RequestInit = {}) => fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
async function must(r: Response, what: string) { if (!r.ok) throw new Error(`${what} answered HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ""}`); return r; }

export async function slack(text: string) {
  const c = config().notification.slack;
  if (!c.webhookUrl) throw new Error("Slack webhook URL is not set.");
  await must(await go(c.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }), "Slack");
  return "Message posted to Slack.";
}
export async function telegram(text: string) {
  const c = config().notification.telegram;
  if (!c.botToken || !c.chatId) throw new Error("Telegram bot token and chat ID are required.");
  const r = await go(`https://api.telegram.org/bot${c.botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c.chatId, text }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram: ${j.description ?? `HTTP ${r.status}`}`);
  return "Message sent to Telegram.";
}
export async function email(to: string, text: string) {
  const r = await sendMail({ to: [to], subject: "Fortify test notification", text, attachment: { filename: "test.txt", content: text, contentType: "text/plain" } });
  return r.mode === "smtp" ? `Email sent to ${to}.` : `SMTP not configured: saved to ${r.id}.`;
}

// Webhook: JSON POST with an HMAC-SHA256 signature of the body in X-Fortify-Signature (when a secret is set).
export async function webhook(event: string, data: unknown) {
  const c = config().api;
  if (!c.webhookUrl) throw new Error("Webhook URL is not set.");
  const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data });
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Fortify-Event": event };
  if (c.webhookSecret) headers["X-Fortify-Signature"] = `sha256=${createHmac("sha256", c.webhookSecret).update(body).digest("hex")}`;
  await must(await go(c.webhookUrl, { method: "POST", headers, body }), "Webhook");
  return `Webhook delivered (${event}).`;
}

export async function loki(line: string, labels: Record<string, string> = {}) {
  const c = config().integration.grafana;
  if (!c.lokiUrl) throw new Error("Loki URL is not set.");
  const auth: Record<string, string> = c.user || c.apiKey ? { Authorization: `Basic ${Buffer.from(`${c.user}:${c.apiKey}`).toString("base64")}` } : {};
  const url = new URL("/loki/api/v1/push", c.lokiUrl).toString();
  await must(await go(url, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ streams: [{ stream: { app: "fortify", ...labels }, values: [[`${Date.now()}000000`, line]] }] }) }), "Loki");
  return "Log line pushed to Grafana Loki.";
}

// Firestore over REST: service-account JWT → OAuth token → list one document. No SDK needed.
export async function firestore() {
  const c = config().integration.firestore;
  if (!c.projectId || !c.serviceAccountJson) throw new Error("Project ID and service account JSON are required.");
  const sa = JSON.parse(c.serviceAccountJson) as { client_email: string; private_key: string };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 300 })}`;
  const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`;
  const tok = await (await must(await go("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) }), "Google OAuth")).json();
  await must(await go(`https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/${encodeURIComponent(c.databaseId || "(default)")}/documents?pageSize=1`, { headers: { Authorization: `Bearer ${tok.access_token}` } }), "Firestore");
  return `Connected to Firestore ${c.projectId}/${c.databaseId || "(default)"}.`;
}

export async function endpoint(i: number) {
  const e = config().integration.endpoints[i];
  if (!e) throw new Error("Endpoint not found.");
  const r = await go(e.url, { method: "GET" });
  return `${e.name}: HTTP ${r.status}`;
}

export const runTest = (target: string, arg: string): Promise<TestResult> => timed(async () => {
  const msg = `Fortify test notification at ${new Date().toISOString()}`;
  switch (target) {
    case "smtp": if (!arg) throw new Error("Enter an email address to send the test to."); return email(arg, msg);
    case "slack": return slack(msg);
    case "telegram": return telegram(msg);
    case "webhook": return webhook("test", { message: msg });
    case "firestore": return firestore();
    case "grafana": return loki(msg, { event: "test" });
    case "endpoint": return endpoint(Number(arg));
    case "sms": case "push": {
      const ch = config().customer[target as "sms" | "push"];
      if (!ch.url) throw new Error(`${target.toUpperCase()} gateway URL is not set.`);
      const [hk, ...hv] = ch.authHeader.split(":"), text = `${config().general.appName}: test message ${new Date().toISOString()}`;
      const body = ch.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => JSON.stringify(String({ phone: arg, text, customerId: arg, bank: config().general.appName }[k as string] ?? "")).slice(1, -1));
      await must(await go(ch.url, { method: "POST", headers: { "Content-Type": "application/json", ...(ch.authHeader && hv.length ? { [hk.trim()]: hv.join(":").trim() } : {}) }, body }), target.toUpperCase());
      return `Test ${target.toUpperCase()} accepted by the gateway${arg ? ` for ${arg}` : ""}.`;
    }
    case "gemini": {
      if (!geminiConfigured()) throw new Error("No API key or project set.");
      const r = await generate("Reply with the single word OK.", AbortSignal.timeout(TIMEOUT), { systemInstruction: "You are a connectivity check.", text: true });
      return `Gemini answered "${r.text.trim().slice(0, 40)}" (model ${geminiInfo().model}, via ${geminiInfo().via === "api_key" ? "API key" : "Vertex AI"}).`;
    }
    default: throw new Error("Unknown integration.");
  }
});

// Live fan-out of alert events to the channels switched on in Settings. Failures are logged, never thrown.
const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
export function startDispatcher() {
  const g = globalThis as { __fortifyDispatch?: () => void };
  if (g.__fortifyDispatch) return;
  g.__fortifyDispatch = subscribe(async (e: { type: string; row: AlertRow }) => {
    const c = config(), r = e.row, sev = (r.aiLevel ?? r.baselineLevel) as keyof typeof RANK;
    const jobs: Promise<unknown>[] = [];
    if (c.api.webhookUrl && ((e.type === "alert.created" && c.api.webhookEvents.alertCreated) || (e.type === "alert.updated" && r.status === "Decided" && c.api.webhookEvents.alertResolved)))
      jobs.push(webhook(e.type, { id: r.id, status: r.status, severity: sev, amount: r.amount, customer: r.customerName, transactionId: r.transactionId }));
    if (e.type === "alert.created" && RANK[sev] >= RANK[c.notification.minSeverity]) {
      const text = `🚨 ${sev} fraud alert ${r.id}: ${r.customerName} ${idr(r.amount)} → ${r.beneficiary.masked}`;
      if (c.notification.slack.enabled) jobs.push(slack(text));
      if (c.notification.telegram.enabled) jobs.push(telegram(text));
    }
    if (c.integration.grafana.enabled) jobs.push(loki(JSON.stringify({ event: e.type, id: r.id, status: r.status, severity: sev }), { event: e.type }));
    for (const j of await Promise.allSettled(jobs)) if (j.status === "rejected") console.warn("[fortify] notification failed:", (j.reason as Error).message);
  });
}
