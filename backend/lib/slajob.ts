import { publish } from "./alerts.ts";
import { audit } from "./auditlog.ts";
import { escalateDue } from "./cases.ts";
import { slack, telegram } from "./integrations.ts";
import { config } from "./settings.ts";
import { getStore } from "./store";

// Every minute: escalate alerts / cases past their SLA, log it, refresh live views and tell Slack / Telegram (if switched on).
export function runSlaWatch(now = Date.now()) {
  const s = getStore(), out = escalateDue(s, now);
  for (const e of out) {
    audit({ actor: "system:sla", entityType: "alert", entityId: e.id, action: "SLA_ESCALATED", before: {}, after: { kind: e.kind } });
    if (e.kind === "alert") { const a = s.alerts.find((x) => x.id === e.id); if (a) publish("alert.updated", s, a); }
  }
  const c = config().notification;
  if (out.length && (c.slack.enabled || c.telegram.enabled)) {
    const text = out.length > 5 ? `⏰ ${out.length} alerts / cases breached their SLA. First: ${out.slice(0, 3).map((x) => x.id).join(", ")}…` : `⏰ SLA breached:\n${out.map((x) => `• ${x.text}`).join("\n")}`;
    for (const send of [c.slack.enabled && slack, c.telegram.enabled && telegram]) if (send) send(text).catch((err: Error) => console.warn("[fortify] SLA notification failed:", err.message));
  }
  return out;
}

export function startSlaWatch() {
  const g = globalThis as { __fortifySla?: NodeJS.Timeout };
  g.__fortifySla ??= setInterval(runSlaWatch, 60000).unref();
}
