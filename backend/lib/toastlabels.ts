// Success message for a mutating console request, or null when it should not toast (reads, chats, tests, previews).
export function toastLabel(method: string, path: string, body?: unknown): string | null {
  const m = method.toUpperCase(), p = path.replace(/\?.*$/, "");
  if (m === "GET" || m === "HEAD") return null;
  if (/^\/api\/(auth|demo|copilot)\b|\/test$|\/try$|^\/api\/rules\/generate$|^\/api\/intel\/aml\/screen$/.test(p)) return null;
  if (p === "/api/graphql") return typeof body === "string" && /\bmutation\b/.test(body) && /acknowledgeAlert/.test(body) ? "Alert acknowledged" : null;
  if (p === "/api/rules/import") return typeof FormData !== "undefined" && body instanceof FormData && !body.has("files") ? null : "Rules imported";
  const rules: [RegExp, string | ((m: string) => string)][] = [
    [/^\/api\/alerts\/[^/]+\/decision$/, "Decision saved"],
    [/^\/api\/alerts\/[^/]+\/investigate$/, "Assistant investigation started"],
    [/^\/api\/rules\/[^/]+\/activate$/, "Rule activated"], [/^\/api\/rules\/[^/]+\/deactivate$/, "Rule deactivated"],
    [/^\/api\/rules\/[^/]+\/backtest$/, "Backtest complete"],
    [/^\/api\/rules$/, "Rule created"], [/^\/api\/rules\/[^/]+$/, (x) => (x === "DELETE" ? "Rule deleted" : "Rule saved")],
    [/^\/api\/workflows$/, "Workflow created"], [/^\/api\/workflows\/[^/]+\/deploy$/, "Workflow deployed"], [/^\/api\/workflows\/[^/]+\/archive$/, "Workflow archived"],
    [/^\/api\/workflows\/[^/]+\/restore$/, "Workflow restored"], [/^\/api\/workflows\/[^/]+\/rollback$/, "Version restored"],
    [/^\/api\/workflows\/[^/]+\/publish$/, "Endpoint published"], [/^\/api\/workflows\/[^/]+\/unpublish$/, "Endpoint unpublished"],
    [/^\/api\/workflows\/[^/]+\/endpoint-on$/, "Endpoint activated"], [/^\/api\/workflows\/[^/]+\/endpoint-off$/, "Endpoint deactivated"], [/^\/api\/workflows\/[^/]+\/scoring-on$/, "Workflow now serves the built-in API"], [/^\/api\/workflows\/[^/]+\/scoring-off$/, "API back to the built-in pipeline"],
    [/^\/api\/workflows\/[^/]+$/, (x) => (x === "DELETE" ? "Workflow deleted" : "Workflow saved")],
    [/^\/api\/settings\/requests\/[^/]+\/approve$/, "Request approved and applied"], [/^\/api\/settings\/requests\/[^/]+\/reject$/, "Request rejected"],
    [/^\/api\/settings\/requests$/, "Submitted for approval"],
    [/^\/api\/settings\/config$/, "Settings saved"], [/^\/api\/settings\/apikeys$/, "API key generated"], [/^\/api\/settings\/apikeys\/[^/]+\/revoke$/, "API key revoked"],
    [/^\/api\/reports\/email$/, "Report email sent"],
    [/^\/api\/intel\/watchlist$/, "Added to the watchlist"], [/^\/api\/intel\/watchlist\/[^/]+$/, "Removed from the watchlist"],
    [/^\/api\/intel\/aml$/, "AML entry added"], [/^\/api\/intel\/aml\/[^/]+$/, "AML entry removed"],
    [/^\/api\/cases$/, "Case created"], [/^\/api\/cases\/[^/]+\/alerts$/, "Alerts added to the case"], [/^\/api\/cases\/[^/]+$/, "Case updated"],
    [/^\/api\/notes$/, "Note added"], [/^\/api\/attachments$/, "File attached"], [/^\/api\/alerts\/[^/]+\/assign$/, "Alert reassigned"], [/^\/api\/reports\/schedules$/, "Schedule created"],
    [/^\/api\/reports\/schedules\/[^/]+\/run$/, "Scheduled report sent"], [/^\/api\/reports\/schedules\/[^/]+$/, "Schedule deleted"],
  ];
  for (const [re, l] of rules) if (re.test(p)) return typeof l === "string" ? l : l(m);
  return "Saved";
}
