import { test } from "node:test";
import assert from "node:assert/strict";
import { acknowledge, queryAlerts } from "../lib/alertview.ts";

const mk = () => ({
  rules: [{ id: "R1", name: "Big transfer", status: "Active", severity: "HIGH", condition: { all: [{ field: "amount", op: ">", value: 1000 }] } }],
  customers: [{ id: "C1", name: "Budi", maskedAccount: "•••1", avgDailySpend: 10, homeCountry: "ID" }],
  transactions: [
    { id: "T1", customerId: "C1", sessionId: null, createdAt: "2026-10-14T03:00:00Z", amount: 5000, beneficiary: { accountId: "B1", isNew: true, accountAgeDays: 5 } },
    { id: "T2", customerId: "C1", sessionId: null, createdAt: "2026-10-15T03:00:00Z", amount: 50, beneficiary: { accountId: "B2", isNew: true, accountAgeDays: 400 } },
  ],
  sessions: [], network: [], audit: [],
  alerts: [
    { id: "A1", transactionId: "T1", customerId: "C1", createdAt: "2026-10-14T03:00:00Z", baselineScore: 70, baselineLevel: "HIGH", status: "New", assignedTo: "" },
    { id: "A2", transactionId: "T2", customerId: "C1", createdAt: "2026-10-15T03:00:00Z", baselineScore: 30, baselineLevel: "MEDIUM", status: "Decided", assignedTo: "x" },
  ],
}) as never;

test("query: status vocabulary, date filter, rule name from active rule or baseline", () => {
  const s = mk();
  const all = queryAlerts(s, {});
  assert.deepEqual(all.items.map((a) => [a.id, a.status, a.ruleName]), [["A2", "RESOLVED", "Baseline: New beneficiary"], ["A1", "ACTIVE", "Big transfer"]]);
  assert.equal(queryAlerts(s, { status: "ACTIVE" }).total, 1);
  assert.equal(queryAlerts(s, { from: "2026-10-15" }).items[0].id, "A2");
});

test("acknowledge claims an active alert once", () => {
  const s = mk() as { alerts: { status: string; assignedTo: string }[]; audit: unknown[] };
  assert.ok(typeof acknowledge(s as never, "A1", "sari") !== "string");
  assert.equal(s.alerts[0].status, "Investigating");
  assert.equal(s.alerts[0].assignedTo, "sari");
  assert.equal(typeof acknowledge(s as never, "A1", "sari"), "string");
  assert.equal(s.audit.length, 1);
});
