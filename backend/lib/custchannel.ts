import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./settings.ts";
import type { State } from "./store";
import type { Customer, Transaction } from "./types";

// Real customer actions: OTP for "Challenge customer" and notices for declined / frozen / released transfers,
// sent over the SMS and push gateways in Settings → Notification → Customer messages. With no gateway on, messages
// land in the console outbox (Risk Intelligence → Customer messages) so the flow is testable end to end.
export type MsgKind = "challenge" | "declined" | "frozen" | "released" | "notice";
export interface CustomerMessage { id: string; at: string; customerId: string; to: string; channel: "SMS" | "PUSH" | "OUTBOX"; kind: MsgKind; text: string; status: "SENT" | "FAILED" | "OUTBOX"; error?: string; ref: string }
export interface Challenge { hash: string; expiresAt: string; attemptsLeft: number; customerId: string; status: "PENDING" | "VERIFIED" | "FAILED" | "EXPIRED" }

const MAX_LOG = 1000;
const mask = (p: string) => p.replace(/^(\+?\d{4})\d+(\d{3})$/, "$1•••••$2");
const json = (s: string) => JSON.stringify(s).slice(1, -1); // safe inside a JSON string template
const fill = (t: string, v: Record<string, string>, esc = false) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (esc ? json(v[k] ?? "") : v[k] ?? ""));

async function post(ch: { url: string; authHeader: string; body: string }, vars: Record<string, string>) {
  const [hk, ...hv] = ch.authHeader.split(":");
  const r = await fetch(ch.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "Content-Type": "application/json", ...(ch.authHeader && hv.length ? { [hk.trim()]: hv.join(":").trim() } : {}) }, body: fill(ch.body, vars, true) });
  if (!r.ok) throw new Error(`gateway answered HTTP ${r.status}`);
}

export async function sendToCustomer(s: State, c: Customer, kind: Exclude<MsgKind, "notice">, tx: Transaction, extra: Record<string, string> = {}) {
  const cfg = config().customer, phone = c.phone ?? "";
  const vars = { bank: config().general.appName, amount: tx.amount.toLocaleString("id-ID"), beneficiary: tx.beneficiary.name, customerId: c.id, phone, minutes: String(cfg.otpMinutes), ...extra };
  const text = fill(cfg.templates[kind], vars), log = (m: Omit<CustomerMessage, "id" | "at" | "customerId" | "kind" | "ref">) => {
    s.messages.unshift({ id: `MSG-${Date.now().toString(36)}${randomInt(1000)}`, at: new Date().toISOString(), customerId: c.id, kind, ref: tx.id, ...m });
    if (s.messages.length > MAX_LOG) s.messages.length = MAX_LOG;
  };
  const shown = extra.otp ? text.replace(extra.otp, "••••••") : text; // an OTP that really went out is never stored in clear
  const chans = ([["SMS", cfg.sms], ["PUSH", cfg.push]] as const).filter(([, ch]) => ch.enabled && ch.url);
  if (!chans.length) { log({ channel: "OUTBOX", to: mask(phone), text, status: "OUTBOX" }); return; }
  await Promise.all(chans.map(([name, ch]) => post(ch, { ...vars, text }).then(() => log({ channel: name, to: name === "SMS" ? mask(phone) : c.id, text: shown, status: "SENT" }), (e: Error) => log({ channel: name, to: name === "SMS" ? mask(phone) : c.id, text: shown, status: "FAILED", error: e.message }))));
}

// Security notice not tied to a transfer (login / account change). Same gateways and outbox as transfer messages.
export async function sendNotice(s: State, c: Customer, text: string, ref: string) {
  const cfg = config().customer, phone = c.phone ?? "";
  const log = (m: Omit<CustomerMessage, "id" | "at" | "customerId" | "kind" | "ref">) => { s.messages.unshift({ id: `MSG-${Date.now().toString(36)}${randomInt(1000)}`, at: new Date().toISOString(), customerId: c.id, kind: "notice", ref, ...m }); if (s.messages.length > MAX_LOG) s.messages.length = MAX_LOG; };
  const chans = ([["SMS", cfg.sms], ["PUSH", cfg.push]] as const).filter(([, ch]) => ch.enabled && ch.url);
  if (!chans.length) return log({ channel: "OUTBOX", to: mask(phone), text, status: "OUTBOX" });
  const vars = { bank: config().general.appName, customerId: c.id, phone, text };
  await Promise.all(chans.map(([name, ch]) => post(ch, vars).then(() => log({ channel: name, to: name === "SMS" ? mask(phone) : c.id, text, status: "SENT" }), (e: Error) => log({ channel: name, to: name === "SMS" ? mask(phone) : c.id, text, status: "FAILED", error: e.message }))));
}

const digest = (txId: string, otp: string) => createHash("sha256").update(`${txId}:${otp}`).digest("hex");
export function issueChallenge(s: State, tx: Transaction, c: Customer) {
  const cfg = config().customer, otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  s.challenges[tx.id] = { hash: digest(tx.id, otp), expiresAt: new Date(Date.now() + cfg.otpMinutes * 60e3).toISOString(), attemptsLeft: cfg.otpAttempts, customerId: c.id, status: "PENDING" };
  return sendToCustomer(s, c, "challenge", tx, { otp });
}

// Returns "ok" | "wrong" | "locked" | "expired" | "none". Constant-time compare; attempts are limited.
export function checkOtp(s: State, txId: string, otp: string) {
  const ch = s.challenges[txId];
  if (!ch || ch.status !== "PENDING") return ch?.status === "FAILED" ? "locked" : "none";
  if (Date.parse(ch.expiresAt) < Date.now()) { ch.status = "EXPIRED"; return "expired"; }
  const ok = /^\d{6}$/.test(otp) && timingSafeEqual(Buffer.from(digest(txId, otp)), Buffer.from(ch.hash));
  if (ok) { ch.status = "VERIFIED"; return "ok"; }
  if (--ch.attemptsLeft <= 0) { ch.status = "FAILED"; return "locked"; }
  return "wrong";
}
