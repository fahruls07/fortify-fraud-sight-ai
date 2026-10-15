import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { State } from "./store";
import type { Alert } from "./types";

// Case management: cases group alerts; notes and attachments hang off an alert or a case; SLA timers escalate automatically.
export const SLA_HOURS = { CRITICAL: 1, HIGH: 4, MEDIUM: 24, LOW: 72 } as const;
export type Priority = keyof typeof SLA_HOURS;
export const CASE_STATUSES = ["OPEN", "IN_PROGRESS", "ESCALATED", "CLOSED"] as const;
export interface CaseEvent { at: string; by: string; text: string }
export interface Case {
  id: string; title: string; status: (typeof CASE_STATUSES)[number]; priority: Priority; alertIds: string[]; assignee: string;
  createdBy: string; createdAt: string; updatedAt: string; slaDueAt: string; escalated: boolean; closedAt?: string; resolution?: string; events: CaseEvent[];
}
export interface Note { id: string; entity: string; by: string; at: string; text: string }
export interface Attachment { id: string; entity: string; name: string; size: number; type: string; by: string; at: string }

export const slaDue = (p: Priority, from = new Date()) => new Date(+from + SLA_HOURS[p] * 3600e3).toISOString();
export const sevOf = (a: Alert): Priority => (a.aiLevel ?? a.baselineLevel) as Priority;
const pad = (n: number) => String(n).padStart(4, "0");
const RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export const entityOk = (s: State, entity: string) => { const [k, id] = entity.split(":"); return k === "alert" ? s.alerts.some((a) => a.id === id) : k === "case" ? s.cases.some((c) => c.id === id) : k === "session" ? s.sessions.some((x) => x.id === id) : false; };

export function createCase(s: State, b: { title?: unknown; alertIds?: unknown; priority?: unknown; assignee?: unknown }, by: string): Case | string {
  const ids = Array.isArray(b.alertIds) ? [...new Set(b.alertIds.map(String))] : [];
  if (!ids.length || ids.length > 100) return "Pick 1–100 alerts for the case.";
  const alerts = ids.map((id) => s.alerts.find((a) => a.id === id));
  if (alerts.some((a) => !a)) return "Some alerts do not exist.";
  const taken = alerts.find((a) => a!.caseId && s.cases.find((c) => c.id === a!.caseId && c.status !== "CLOSED"));
  if (taken) return `${taken!.id} is already in open case ${taken!.caseId}.`;
  const top = alerts.reduce<Priority>((p, a) => (RANK[sevOf(a!)] > RANK[p] ? sevOf(a!) : p), "LOW");
  const priority = typeof b.priority === "string" && b.priority in SLA_HOURS ? (b.priority as Priority) : top;
  const now = new Date().toISOString(), title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : `${alerts.length} alert(s): ${s.customers.find((c) => c.id === alerts[0]!.customerId)?.name ?? ""}`;
  const c: Case = { id: `CASE-${pad(s.nextCaseSeq++)}`, title, status: "OPEN", priority, alertIds: ids, assignee: typeof b.assignee === "string" ? b.assignee : by, createdBy: by, createdAt: now, updatedAt: now, slaDueAt: slaDue(priority), escalated: false, events: [{ at: now, by, text: `Case opened with ${ids.join(", ")}` }] };
  for (const a of alerts) a!.caseId = c.id;
  s.cases.unshift(c);
  return c;
}

export function addToCase(s: State, c: Case, ids: string[], by: string): string | null {
  for (const id of ids) { const a = s.alerts.find((x) => x.id === id); if (!a) return `${id} not found.`; if (a.caseId && a.caseId !== c.id && s.cases.find((x) => x.id === a.caseId)?.status !== "CLOSED") return `${id} is already in ${a.caseId}.`; }
  const add = ids.filter((id) => !c.alertIds.includes(id));
  for (const id of add) s.alerts.find((x) => x.id === id)!.caseId = c.id;
  c.alertIds.push(...add); c.updatedAt = new Date().toISOString();
  if (add.length) c.events.push({ at: c.updatedAt, by, text: `Merged ${add.join(", ")} into the case` });
  return null;
}

export function updateCase(s: State, c: Case, b: Record<string, unknown>, by: string, users: string[]): string | null {
  const now = new Date().toISOString(), log = (t: string) => c.events.push({ at: now, by, text: t });
  if (b.status !== undefined) {
    if (!CASE_STATUSES.includes(b.status as never)) return "Unknown status.";
    if (b.status === "CLOSED") {
      if (typeof b.resolution !== "string" || !b.resolution.trim()) return "Write a resolution before closing the case.";
      c.resolution = b.resolution.trim().slice(0, 1000); c.closedAt = now;
    } else delete c.closedAt;
    if (b.status !== c.status) log(`Status ${c.status} → ${b.status}${b.status === "CLOSED" ? `: ${c.resolution}` : ""}`);
    c.status = b.status as Case["status"];
  }
  if (b.assignee !== undefined) {
    if (typeof b.assignee !== "string" || !users.includes(b.assignee)) return "Unknown user.";
    if (b.assignee !== c.assignee) log(`Reassigned ${c.assignee || "nobody"} → ${b.assignee}`);
    c.assignee = b.assignee;
  }
  if (b.priority !== undefined) {
    if (typeof b.priority !== "string" || !(b.priority in SLA_HOURS)) return "Unknown priority.";
    if (b.priority !== c.priority) { log(`Priority ${c.priority} → ${b.priority} (SLA restarts)`); c.priority = b.priority as Priority; c.slaDueAt = slaDue(c.priority); c.escalated = false; }
  }
  if (typeof b.title === "string" && b.title.trim() && b.title.trim() !== c.title) { log(`Renamed to "${b.title.trim().slice(0, 120)}"`); c.title = b.title.trim().slice(0, 120); }
  c.updatedAt = now;
  return null;
}

export function addNote(s: State, entity: string, text: unknown, by: string): Note | string {
  if (!entityOk(s, entity)) return "Unknown alert or case.";
  if (typeof text !== "string" || !text.trim() || text.length > 4000) return "Write a note (max 4000 characters).";
  const n: Note = { id: `NOTE-${randomBytes(4).toString("hex")}`, entity, by, at: new Date().toISOString(), text: text.trim() };
  s.notes.push(n);
  return n;
}

// Attachments live on disk under data/runtime/attachments; only metadata is in the state. Served as downloads, never inline.
const DIR = join(/*turbopackIgnore: true*/ process.cwd(), "data", "runtime", "attachments");
export const MAX_BYTES = 5 * 1024 * 1024;
const EXT = /\.(pdf|png|jpe?g|gif|txt|csv|xlsx?|docx?|eml|msg|json|zip)$/i;
export function saveAttachment(s: State, entity: string, name: string, type: string, data: Buffer, by: string): Attachment | string {
  if (!entityOk(s, entity)) return "Unknown alert or case.";
  const clean = name.replace(/[^\w.() -]/g, "_").slice(-120);
  if (!EXT.test(clean)) return "Allowed files: PDF, images, TXT, CSV, Excel, Word, EML/MSG, JSON, ZIP.";
  if (!data.length || data.length > MAX_BYTES) return "File must be 1 byte to 5 MB.";
  if (s.attachments.filter((a) => a.entity === entity).length >= 50) return "At most 50 attachments per alert or case.";
  const a: Attachment = { id: `ATT-${randomBytes(8).toString("hex")}`, entity, name: clean, size: data.length, type: type.slice(0, 100) || "application/octet-stream", by, at: new Date().toISOString() };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, a.id), data);
  s.attachments.push(a);
  return a;
}
export const readAttachment = (a: Attachment) => readFileSync(join(DIR, a.id));

// SLA watchdog: open alerts and cases past due are marked escalated (once) and reported back for notification.
export function escalateDue(s: State, now = Date.now()) {
  const at = new Date(now).toISOString(), out: { kind: "alert" | "case"; id: string; text: string }[] = [];
  for (const a of s.alerts) {
    if (a.status === "Decided" || a.escalated || !a.slaDueAt || Date.parse(a.slaDueAt) > now) continue;
    a.escalated = true; a.escalatedAt = at;
    out.push({ kind: "alert", id: a.id, text: `${a.id} (${sevOf(a)}) passed its ${SLA_HOURS[sevOf(a)]} h SLA without a decision` });
  }
  for (const c of s.cases) {
    if (c.status === "CLOSED" || c.escalated || Date.parse(c.slaDueAt) > now) continue;
    c.escalated = true; c.status = "ESCALATED"; c.updatedAt = at; c.events.push({ at, by: "system:sla", text: `Escalated: ${SLA_HOURS[c.priority]} h SLA breached` });
    out.push({ kind: "case", id: c.id, text: `${c.id} "${c.title}" breached its ${SLA_HOURS[c.priority]} h SLA` });
  }
  return out;
}
