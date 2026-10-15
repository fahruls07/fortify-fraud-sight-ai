import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { config } from "./settings.ts";

// SMTP from Settings → Notification (or the SMTP_* env vars), mail goes out over SMTP. Without it, each message is written as a real .eml file to data/runtime/outbox
// (open it in any mail client) so the flow works end to end in the demo without credentials.
const OUTBOX = join(/*turbopackIgnore: true*/ process.cwd(), "data", "runtime", "outbox");
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;

export function parseRecipients(raw: unknown): string[] | string {
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const uniq = [...new Set(list)];
  if (!uniq.length) return "Enter at least one email address.";
  if (uniq.length > 10) return "At most 10 recipients.";
  const bad = uniq.find((e) => !EMAIL.test(e) || e.length > 254);
  return bad ? `Invalid email address: ${bad}` : uniq;
}

export async function sendMail(m: { to: string[]; subject: string; text: string; attachment: { filename: string; content: string; contentType: string } }) {
  const c = config().notification.smtp, env = process.env;
  const s = c.host ? c : { host: env.SMTP_HOST ?? "", port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === "true", user: env.SMTP_USER ?? "", pass: env.SMTP_PASS ?? "", from: env.MAIL_FROM ?? c.from };
  const smtp = s.host;
  const t = smtp
    ? nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined, connectionTimeout: 8000 })
    : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await t.sendMail({ from: s.from || "Fortify <reports@fortify.local>", to: m.to, subject: m.subject, text: m.text, attachments: [m.attachment] });
  if (smtp) return { mode: "smtp" as const, id: info.messageId };
  mkdirSync(OUTBOX, { recursive: true });
  const file = join(OUTBOX, `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}.eml`);
  writeFileSync(file, (info as unknown as { message: Buffer }).message);
  return { mode: "outbox" as const, id: file.split("/").slice(-4).join("/") };
}
