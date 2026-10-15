// Next.js calls this once per server start: background jobs (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("./lib/schedules")).startScheduler();   // scheduled report emails
  (await import("./lib/integrations")).startDispatcher(); // webhook / Slack / Telegram / Loki on alert events
  (await import("./lib/autoresolve")).startAutoResolve(); // optional auto-resolve of stale LOW alerts
  (await import("./lib/slajob")).startSlaWatch();         // SLA escalation of alerts and cases
}
