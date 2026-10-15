import { config } from "./settings.ts";
import { getStore } from "./store";
import { decide } from "./transfers";

// Settings → General → "Auto-resolve after N hours" (0 = off). Only LOW-severity alerts still untouched (New) and still HELD:
// they are approved as NOT_FRAUD by "system:auto-resolve", which releases the transfer and is written to the audit log.
export function autoResolveDue(now = Date.now()) {
  const h = config().general.autoResolveHours;
  if (!h) return [];
  const s = getStore(), done: string[] = [];
  for (const a of s.alerts) {
    const tx = s.transactions.find((t) => t.id === a.transactionId);
    if (a.status !== "New" || (a.aiLevel ?? a.baselineLevel) !== "LOW" || tx?.status !== "HELD" || now - Date.parse(a.createdAt) < h * 3600e3) continue;
    try { decide(a.id, { action: "APPROVE", label: "NOT_FRAUD", reason: `Auto-resolved: low severity, no action for ${h} h` }, "system:auto-resolve"); done.push(a.id); }
    catch (e) { console.warn(`[fortify] auto-resolve ${a.id} failed:`, (e as Error).message); }
  }
  return done;
}

export function startAutoResolve() {
  const g = globalThis as { __fortifyAutoResolve?: NodeJS.Timeout };
  g.__fortifyAutoResolve ??= setInterval(autoResolveDue, 5 * 60000).unref();
}
