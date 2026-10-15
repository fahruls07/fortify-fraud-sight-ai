import { test } from "node:test";
import assert from "node:assert/strict";
import { metrics, migrate, runWorkflow, SAMPLE_FIELDS, saveVersion, SEED_WORKFLOWS, validateWorkflow, type Services, type TestEvent } from "../lib/workflows.ts";

const svc: Services = {
  rule: (id) => (id === "RULE-0001" ? { id, name: "Big", status: "Active", expression: "amount > 1000", condition: { all: [{ field: "amount", op: ">", value: 1000 }] } } as never : undefined),
  db: (q) => (q === "beneficiary_alert_count" ? 2 : 0),
  api: async () => ({ data: { risk: 77 } }),
  ai: async () => ({ score: 90, label: "CRITICAL", reason: "test", source: "fake" }),
  aml: (c) => ({ hit: c.beneficiary_name === "Bad Guy", score: c.beneficiary_name === "Bad Guy" ? 90 : 0, reasons: c.beneficiary_name === "Bad Guy" ? ["sanctions match"] : [] }),
};
const quiet = { ...SAMPLE_FIELDS, amount: 100, avg_daily_spend: 100, new_beneficiary: false, new_device: false, vpn: false, screen_sharing: false };
const ev = (f: Partial<TestEvent["fields"]> = {}): TestEvent => ({ event: "transaction_created", source: "mobile_app", fields: { ...quiet, ...f } });
const wf = (nodes: unknown[], edges: [string, string][]) => { const v = validateWorkflow({ name: "t", nodes, edges: edges.map(([source, target]) => ({ source, target })) }); if ("error" in v) throw new Error(v.error); return v.workflow; };
const T = { id: "t", type: "trigger", data: { event: "transaction_created" } }, A = (id: string) => ({ id, type: "action", data: { action: "send_alert" } });
const crit = (id: string, field: string, operator: string, value: unknown) => ({ id, type: "criteria", data: { criteria: [{ field, operator, value }] } });

test("legacy shapes upgrade; user's example validates", () => {
  assert.ok("workflow" in validateWorkflow({ id: "wf_001", name: "High Amount Check", nodes: [{ id: "1", type: "trigger", data: { event: "transaction_created" } }, { id: "2", type: "condition", data: { field: "amount", operator: ">", value: 10000 } }, { id: "3", type: "action", data: { action: "send_alert" } }], edges: [{ source: "1", target: "2" }, { source: "2", target: "3" }] }));
  const v = validateWorkflow({ name: "x", nodes: [T, { id: "g", type: "gateway", data: { mode: "AND" } }, A("a")], edges: [] });
  assert.ok("workflow" in v && (v.workflow.nodes[1].data as { kind: string }).kind === "parallel");
});

test("rejects loops, bad formula, overriding event fields, bad params", () => {
  assert.match((validateWorkflow({ name: "x", nodes: [T, { id: "g1", type: "gateway", data: { kind: "inclusive" } }, { id: "g2", type: "gateway", data: { kind: "inclusive" } }, A("a")], edges: [{ source: "g1", target: "g2" }, { source: "g2", target: "g1" }] }) as { error: string }).error, /loop/);
  assert.ok("error" in validateWorkflow({ name: "x", nodes: [T, { id: "c", type: "calculation", data: { expression: "amount +", output: "x" } }, A("a")], edges: [] }));
  assert.ok("error" in validateWorkflow({ name: "x", nodes: [T, { id: "c", type: "calculation", data: { expression: "1", output: "amount" } }, A("a")], edges: [] }));
  assert.ok("error" in validateWorkflow({ name: "x", nodes: [T, { id: "p", type: "parallel_action", data: { actions: [{ action: "send_alert" }] } }], edges: [] }));
});

test("data nodes feed criteria: calculation → scoring → calculated field → exclusive gateway", async () => {
  const w = SEED_WORKFLOWS()[0];
  const hi = await runWorkflow(w, ev({ amount: 5000, new_beneficiary: true, new_device: true }), svc); // ratio 50 → +30 +15 +15 +20 (2 ben alerts) = 80
  assert.equal(hi.variables.score, 80); assert.equal(hi.variables.risk_band, "high");
  assert.deepEqual(hi.fired.map((f) => f.action), ["flag_for_review", "notify_user", "send_alert"]);
  const mid = await runWorkflow(w, ev({ amount: 5000 }), svc); // +30 ratio +20 db = 50
  assert.equal(mid.variables.risk_band, "medium"); assert.deepEqual(mid.fired.map((f) => f.id), ["10"]);
  const lo = await runWorkflow(w, ev(), svc); // only the db +20
  assert.equal(lo.variables.risk_band, "low"); assert.equal(lo.fired.length, 0);
});

test("rule, AI, API and DB nodes write variables; errors are logged, not thrown", async () => {
  const w = wf([T, { id: "r", type: "rule", data: { ruleId: "RULE-0001", output: "big" } }, { id: "ai", type: "ai", data: { prompt: "Risk for {{amount}}?", output: "ai_risk" } },
    { id: "api", type: "api_call", data: { method: "GET", url: "https://x.example/r", path: "data.risk", output: "ext" } }, crit("c", "ai_risk", ">=", 80), A("a")],
    [["t", "r"], ["r", "ai"], ["ai", "api"], ["api", "c"], ["c", "a"]]);
  const r = await runWorkflow(w, ev({ amount: 5000 }), svc);
  assert.deepEqual([r.variables.big, r.variables.ai_risk, r.variables.ai_risk_label, r.variables.ext], [true, 90, "CRITICAL", 77]);
  assert.equal(r.fired.length, 1);
  assert.equal((await runWorkflow(w, ev({ amount: 10 }), svc)).fired.length, 0); // rule fails → path stops
  const broken = await runWorkflow(wf([T, { id: "r", type: "rule", data: { ruleId: "RULE-9999" } }, A("a")], [["t", "r"], ["r", "a"]]), ev(), svc);
  assert.match(broken.errors[0], /not found/); assert.equal(broken.fired.length, 0);
});

test("exclusive vs inclusive; parallel join", async () => {
  const mk = (kind: string) => wf([T, { id: "g", type: "gateway", data: { kind } }, crit("c1", "amount", ">", 5), crit("c2", "amount", ">", 1), A("a1"), A("a2")], [["t", "g"], ["g", "c1"], ["g", "c2"], ["c1", "a1"], ["c2", "a2"]]);
  assert.deepEqual((await runWorkflow(mk("exclusive"), ev({ amount: 10 }), svc)).fired.map((f) => f.id), ["a1"]);
  assert.deepEqual((await runWorkflow(mk("exclusive"), ev({ amount: 3 }), svc)).fired.map((f) => f.id), ["a2"]);
  assert.deepEqual((await runWorkflow(mk("inclusive"), ev({ amount: 10 }), svc)).fired.map((f) => f.id), ["a1", "a2"]);
});

test("versions, migrate, metrics", () => {
  const w = SEED_WORKFLOWS()[0];
  saveVersion(w, { name: "v2", nodes: w.nodes, edges: w.edges }, "sari", "tweak");
  assert.equal(w.version, 2); assert.equal(w.deployedVersion, 1);
  const old = migrate({ id: "wf_9", name: "old", nodes: [T, A("a")] as never, edges: [{ source: "t", target: "a" }], updatedAt: "2026-01-01T00:00:00Z", updatedBy: "x" });
  assert.equal(old.status, "Draft");
  const m = metrics([{ at: new Date().toISOString(), ms: 2, ok: true, fired: ["send_alert"] }, { at: new Date().toISOString(), ms: 4, ok: false, fired: [] }]);
  assert.equal(m.successRate, 0.5); assert.equal(m.avgMs, 3);
});

test("AML check node writes variables and can gate the path", async () => {
  const w = wf([T, { id: "m", type: "aml_check", data: { output: "aml", failOnHit: true } }, A("a")], [["t", "m"], ["m", "a"]]);
  const hit = await runWorkflow(w, ev({ beneficiary_name: "Bad Guy" }), svc);
  assert.deepEqual([hit.variables.aml_hit, hit.variables.aml_score, hit.fired.length], [true, 90, 1]);
  assert.equal((await runWorkflow(w, ev({ beneficiary_name: "Nice" }), svc)).fired.length, 0);
});

test("all-features demo: every node type and action, valid, and routes by risk band", async () => {
  const { ALL_FEATURES } = await import("../lib/workflows.ts");
  const v = validateWorkflow(ALL_FEATURES());
  assert.ok("workflow" in v, "error" in v ? v.error : "");
  const w = (v as { workflow: { nodes: { type: string; data: Record<string, unknown> }[] } }).workflow;
  for (const k of ["trigger", "gateway", "timer", "condition", "criteria", "rule", "scoring", "calculation", "calc_field", "db_query", "api_call", "ai", "aml_check", "action", "parallel_action"]) assert.ok(w.nodes.some((n) => n.type === k), k);
  assert.deepEqual([...new Set(w.nodes.filter((n) => n.type === "gateway").map((n) => n.data.kind))].sort(), ["exclusive", "inclusive", "parallel"]);
  const acts = new Set(w.nodes.flatMap((n) => n.type === "action" ? [n.data.action] : n.type === "parallel_action" ? (n.data.actions as { action: string }[]).map((a) => a.action) : []));
  assert.equal(acts.size, 5);
  const wf = (v as { workflow: Parameters<typeof runWorkflow>[0] }).workflow;
  const hi = await runWorkflow(wf, ev({ amount: 5000, new_beneficiary: true, screen_sharing: true, vpn: true }), svc); // 25+15+20+20(ai 90)+20+10 = 110 → critical
  assert.equal(hi.variables.risk_band, "critical");
  assert.ok(hi.fired.some((f) => f.action === "block_transaction") && hi.fired.some((f) => f.id === "alertSoc"));
  const lo = await runWorkflow(wf, ev(), svc);
  assert.ok(!lo.fired.some((f) => f.action === "block_transaction" || f.action === "challenge_customer"));
});

test("a failing enrichment node (API / AI / DB) continues with null instead of stopping the path", async () => {
  const w = wf([T, { id: "api", type: "api_call", data: { method: "GET", url: "https://x.example/r", output: "ext" } }, crit("c", "amount", ">", 1), A("a")], [["t", "api"], ["api", "c"], ["c", "a"]]);
  const down = { ...svc, api: async () => { throw new Error("bureau down"); } };
  const r = await runWorkflow(w, ev({ amount: 5 }), down);
  assert.equal(r.fired.length, 1); assert.equal(r.variables.ext, null); assert.match(r.errors[0], /bureau down/);
});

test("baseline node reproduces the built-in score and is tunable", async () => {
  const { baseline, BASELINE_DEFAULT } = await import("../lib/workflows.ts");
  const ctx = { amount: 2_500_000_000, avg_daily_spend: 2_700_000, new_beneficiary: false, beneficiary_age_days: 1200, new_device: false, failed_attempts: 0, pin_correct: true };
  assert.deepEqual([baseline(BASELINE_DEFAULT, ctx).score, baseline(BASELINE_DEFAULT, ctx).level], [40, "MEDIUM"]); // 25 + 30 − 10 − 5, same as the API
  const strict = { ...BASELINE_DEFAULT, weights: { ...BASELINE_DEFAULT.weights, over200x: 60 } };
  assert.equal(baseline(strict, ctx).level, "HIGH");
  assert.equal(baseline(BASELINE_DEFAULT, { ...ctx, amount: 150_000_000, avg_daily_spend: 100_000_000 }).level, "MEDIUM"); // high-value floor
});

test("default scoring workflow: rules DECLINE / CHALLENGE / HOLD, whitelist, blacklist, AML and baseline route like the built-in", async () => {
  const { DEFAULT_SCORING } = await import("../lib/workflows.ts");
  const v = validateWorkflow(DEFAULT_SCORING()); assert.ok("workflow" in v, "error" in v ? v.error : "");
  const w = (v as { workflow: Parameters<typeof runWorkflow>[0] }).workflow;
  const rule = (action: string, field: string, value: unknown) => ({ id: `R-${action}`, name: action, status: "Active", action, severity: "HIGH", expression: "", condition: { all: [{ field, op: "==", value }] } });
  const S = (rules: unknown[], aml = false) => ({ ...svc, rules: () => rules as never, aml: () => ({ hit: aml, score: aml ? 90 : 0, reasons: [] }) });
  const out = async (f: Partial<TestEvent["fields"]>, s: Services) => (await runWorkflow(w, ev(f), s)).fired.map((x) => x.action).join(",") || "allow";
  assert.equal(await out({ vpn: true }, S([rule("DECLINE", "isVpnDetected", true), rule("HOLD", "isVpnDetected", true)])), "block_transaction");
  assert.equal(await out({ rooted: true }, S([rule("CHALLENGE", "deviceRooted", true)])), "challenge_customer");
  assert.equal(await out({}, S([rule("HOLD", "isNewBeneficiary", false)])), "flag_for_review");
  assert.equal(await out({}, S([])), "allow");                                         // quiet transfer
  assert.equal(await out({ on_blacklist: true }, S([])), "flag_for_review");            // blacklist
  assert.equal(await out({}, S([], true)), "flag_for_review");                          // AML hit
  assert.equal(await out({ on_whitelist: true, amount: 5000, new_beneficiary: true }, S([])), "allow"); // whitelist relaxes medium
  assert.equal(await out({ amount: 5000, new_beneficiary: true, beneficiary_age_days: 5 }, S([])), "flag_for_review"); // baseline medium
});

test("event score node mirrors the built-in login / change scoring; default event workflows route DENY / CHALLENGE / notice", async () => {
  const { DEFAULT_EVENT, EVENT_DEFAULT, eventScore } = await import("../lib/workflows.ts");
  const login = { on_blacklist: false, new_device: true, geo_anomaly: true, ip_country: "RU", failed_attempts: 3, login_success: false, change_type: "", recent_new_device_login: false, on_whitelist: false };
  assert.deepEqual([eventScore(EVENT_DEFAULT, login).score, eventScore(EVENT_DEFAULT, login).decision], [95, "DENY"]); // 25+20+15+30+5, same as the API
  assert.equal(eventScore(EVENT_DEFAULT, { ...login, new_device: false, geo_anomaly: false, ip_country: "ID", failed_attempts: 0, login_success: true }).decision, "ALLOW");
  assert.equal(eventScore({ ...EVENT_DEFAULT, denyAt: 99 }, login).decision, "CHALLENGE"); // tunable
  const fire = async (k: "login_attempt" | "account_update", f: Partial<TestEvent["fields"]>) => {
    const v = validateWorkflow(DEFAULT_EVENT(k)); assert.ok("workflow" in v, "error" in v ? v.error : "");
    return (await runWorkflow((v as { workflow: Parameters<typeof runWorkflow>[0] }).workflow, { ...ev(f), event: k }, svc)).fired.map((x) => x.action).join(",") || "allow";
  };
  assert.equal(await fire("login_attempt", { new_device: true, geo_anomaly: true, ip_country: "RU", failed_attempts: 3, login_success: false }), "block_transaction,send_alert");
  assert.equal(await fire("login_attempt", { new_device: true, ip_country: "ID" }), "allow"); // 25 < 30
  assert.equal(await fire("account_update", { change_type: "phone", new_device: false }), "challenge_customer,notify_user"); // +30, and the customer is told
  assert.equal(await fire("account_update", { change_type: "address" }), "allow");
});
