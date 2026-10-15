import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreBaseline } from "../lib/scoring.ts";
import { anomalyFlags } from "../lib/signals.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../data/seed/${f}`, import.meta.url), "utf8"));
const customers = load("customers.json"), sessions = load("sessions.json"), alerts = load("alerts.json"), tpl = load("attack-template.json");
const budi = customers.find((c: any) => c.id === "CUST-0001");
const ses = sessions.find((s: any) => s.id === "SES-9001");

test("Budi baseline = 35 MEDIUM HOLD", () => {
  assert.deepEqual(scoreBaseline(tpl, budi, ses), { score: 35, level: "MEDIUM", decision: "HOLD" });
});
test("Budi session has >= 5 anomalous signals", () => {
  assert.ok(Object.values(anomalyFlags(ses, budi)).filter(Boolean).length >= 5);
});
test("seed alerts: >= 120, scores match engine, one control", () => {
  assert.ok(alerts.length >= 120);
  for (const a of alerts) {
    const tx = load("transactions.json").find((t: any) => t.id === a.transactionId);
    const c = customers.find((x: any) => x.id === a.customerId);
    const s = sessions.find((x: any) => x.transactionId === undefined && x.id === tx.sessionId);
    assert.equal(scoreBaseline(tx, c, s).score, a.baselineScore, a.id);
  }
  assert.equal(alerts.find((a: any) => a.id === "ALT-0141").baselineScore, 0);
});

import { signalsView } from "../lib/signals.ts";
test("signals view: Budi has 7 anomalous, device model unflagged", () => {
  const fields = signalsView(ses, budi).groups.flatMap((g) => g.signals);
  assert.equal(fields.filter((f) => f.anomalous).length, 7);
  assert.equal(fields.find((f) => f.field === "deviceModel")!.anomalous, false);
});

test("amount escalation: grows with the multiple and holds high-value transfers", async () => {
  const { escalateAmount } = await import("../lib/scoring.ts");
  const low = { score: 10, level: "LOW" as const, decision: "ALLOW" as const };
  assert.equal(escalateAmount(low, 2_500_000_000, 2_700_000, 100_000_000).decision, "HOLD"); // the reported case: 926x and above threshold
  assert.equal(escalateAmount(low, 2_500_000_000, 2_700_000, 100_000_000).score, 40);
  assert.equal(escalateAmount(low, 150_000_000, 100_000_000, 100_000_000).level, "MEDIUM"); // threshold alone
  assert.equal(escalateAmount(low, 5_000_000, 2_700_000, 100_000_000).decision, "ALLOW"); // ordinary
  assert.equal(escalateAmount(low, 150_000_000, 100_000_000, 0).decision, "ALLOW"); // threshold off
});
