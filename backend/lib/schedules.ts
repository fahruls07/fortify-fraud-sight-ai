import { REPORTS, type ReportFilter, type ReportType } from "./report.ts";
import { reportFile } from "./reportfile.ts";
import { parseRecipients, sendMail } from "./mailer.ts";
import { getStore } from "./store.ts";

export const FREQ = { daily: 1, weekly: 7, monthly: 30 } as const; // value = days of data each run covers
export type Frequency = keyof typeof FREQ;
export interface Schedule {
  id: string; name: string; frequency: Frequency; recipients: string[]; type: ReportType; format: "xls" | "csv";
  severity: string | null; rule: string | null; createdBy: string; createdAt: string; nextRunAt: string;
  lastRunAt?: string; lastResult?: string;
}

const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// Next 07:00 WIB (00:00 UTC) after `from`: every day, every Monday, or the 1st of the month.
export function nextRun(f: Frequency, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  do d.setUTCDate(d.getUTCDate() + 1);
  while ((f === "weekly" && d.getUTCDay() !== 1) || (f === "monthly" && d.getUTCDate() !== 1));
  return d.toISOString();
}

export function periodFor(f: Frequency, at = new Date()): { from: string; to: string } {
  const to = new Date(+at - 864e5), from = new Date(+at - FREQ[f] * 864e5); // up to yesterday, WIB
  return { from: day(from), to: day(to) };
}

export async function emailReport(to: string[], type: ReportType, f: ReportFilter, format: "xls" | "csv", note = "") {
  const file = reportFile(type, f, format);
  const period = `${f.from ?? "start"} to ${f.to ?? "today"}`;
  return sendMail({
    to, subject: `FraudSight AI fraud report: ${REPORTS[type]} (${period})`,
    text: `${note ? `${note}\n\n` : ""}Attached: ${REPORTS[type]} for ${period}${f.severity ? `, severity ${f.severity}` : ""}${f.rule ? `, rule "${f.rule}"` : ""}.\n\nSent by FraudSight AI Console.`,
    attachment: { filename: file.name, content: file.body, contentType: file.mime },
  });
}

export function validateSchedule(b: Record<string, unknown>): Omit<Schedule, "id" | "createdBy" | "createdAt" | "nextRunAt"> | string {
  if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 80) return "Give the schedule a name (max 80 characters).";
  if (!(String(b.frequency) in FREQ)) return "Frequency must be daily, weekly or monthly.";
  if (!(String(b.type) in REPORTS)) return "Unknown report type.";
  if (b.format !== "xls" && b.format !== "csv") return "Format must be xls or csv.";
  const to = parseRecipients(b.recipients);
  if (typeof to === "string") return to;
  return { name: b.name.trim(), frequency: b.frequency as Frequency, recipients: to, type: b.type as ReportType, format: b.format, severity: typeof b.severity === "string" && b.severity ? b.severity : null, rule: typeof b.rule === "string" && b.rule ? b.rule : null };
}

export async function runSchedule(sc: Schedule, now = new Date()) {
  const f = { ...periodFor(sc.frequency, now), severity: sc.severity, rule: sc.rule };
  try { const r = await emailReport(sc.recipients, sc.type, f, sc.format, `Scheduled ${sc.frequency} report "${sc.name}".`); sc.lastResult = r.mode === "smtp" ? "Sent" : `Saved to ${r.id}`; }
  catch (e) { sc.lastResult = `Failed: ${(e as Error).message}`; }
  sc.lastRunAt = now.toISOString();
  return sc;
}

// One timer per server process: every minute, run schedules whose time has come.
export function startScheduler() {
  const g = globalThis as { __fortifyScheduler?: NodeJS.Timeout };
  g.__fortifyScheduler ??= setInterval(async () => {
    const s = getStore(), now = new Date();
    for (const sc of s.reportSchedules) if (sc.nextRunAt <= now.toISOString()) { sc.nextRunAt = nextRun(sc.frequency, now); await runSchedule(sc, now); }
  }, 60000).unref();
}
