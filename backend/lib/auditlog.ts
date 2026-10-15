import type { AuditEvent } from "./types";
import { getStore } from "./store";

// Append one audit event with the next sequential ID.
export function audit(e: Omit<AuditEvent, "id" | "at" | "reason" | "aiRecommendation"> & Partial<Pick<AuditEvent, "reason">>) {
  const s = getStore();
  s.audit.push({ id: `AUD-${String(s.audit.length + 1).padStart(4, "0")}`, at: new Date().toISOString(), reason: null, aiRecommendation: null, ...e });
}
