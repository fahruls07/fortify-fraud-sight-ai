import { test } from "node:test";
import assert from "node:assert/strict";
import { overview } from "../lib/overview.ts";

const now = Date.parse("2026-10-15T10:30:00Z");
const ago = (h: number) => new Date(now - h * 3600e3).toISOString();
const s = {
  fallbackOnly: false,
  customers: [{ id: "C1", name: "Budi", maskedAccount: "•••1" }],
  transactions: [
    { id: "T1", customerId: "C1", createdAt: ago(1), amount: 100, beneficiary: { accountId: "A0001", isNew: true } },
    { id: "T2", customerId: "C1", createdAt: ago(2), amount: 200, beneficiary: { accountId: "A0002", isNew: false } },
    { id: "T3", customerId: "C1", createdAt: ago(48), amount: 300, beneficiary: { accountId: "A0003", isNew: false } },
  ],
  alerts: [
    { id: "ALT-1", transactionId: "T1", customerId: "C1", createdAt: ago(1), baselineScore: 80, baselineLevel: "HIGH", aiLevel: "CRITICAL", status: "Decided" },
    { id: "ALT-2", transactionId: "T2", customerId: "C1", createdAt: ago(2), baselineScore: 40, baselineLevel: "MEDIUM", status: "Decided" },
    { id: "ALT-3", transactionId: "T3", customerId: "C1", createdAt: ago(48), baselineScore: 90, baselineLevel: "HIGH", status: "New" },
  ],
  decisions: [{ alertId: "ALT-1", label: "FRAUD", amount: 100 }, { alertId: "ALT-2", label: "NOT_FRAUD", amount: 200 }],
} as never;

test("24h overview: totals, FP rate, severity uses AI level, trend buckets", () => {
  const o = overview(s, { range: "24h" }, now);
  assert.equal(o.totalTransactions, 2);
  assert.equal(o.fraudDetected, 1);
  assert.equal(o.falsePositiveRate, 0.5);
  assert.equal(o.averageScore, 60);
  assert.deepEqual(o.severity, { LOW: 0, MEDIUM: 1, HIGH: 0, CRITICAL: 1 });
  assert.equal(o.trend.length, 24);
  assert.equal(o.trend.reduce((n, b) => n + b.alerts, 0), 2);
  assert.equal(o.trend.reduce((n, b) => n + b.fraud, 0), 1);
  assert.equal(o.openHigh, 1); // ALT-3 is outside the range but still open: backlog ignores filters
});

test("filters: severity and 7d range", () => {
  assert.equal(overview(s, { range: "7d", severity: "HIGH" }, now).flaggedAlerts, 1);
  assert.equal(overview(s, { range: "7d", status: "New" }, now).latest[0].id, "ALT-3");
});
