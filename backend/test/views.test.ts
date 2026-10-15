import { test } from "node:test";
import assert from "node:assert/strict";
import { feedback, search } from "../lib/views.ts";

const s = {
  customers: [{ id: "CUST-1", name: "Budi Santoso", accountId: "ACC-1", maskedAccount: "•••1", phone: "+62", city: "Jakarta", riskProfile: "LOW" }],
  transactions: [{ id: "TX-1", customerId: "CUST-1", amount: 10, status: "HELD", sessionId: "S1", createdAt: "", beneficiary: { accountId: "ACC-BEN-9", name: "Rizky", bankName: "B" } }],
  sessions: [{ id: "S1", deviceModel: "Pixel 7", ipCountry: "ID" }], alerts: [{ id: "ALT-1", transactionId: "TX-1", customerId: "CUST-1", status: "Decided", baselineScore: 70, baselineLevel: "HIGH" }],
  cases: [], events: [], watchlist: [{ list: "BLACK", type: "ACCOUNT", value: "acc-ben-9", expiresAt: null }],
  decisions: [{ alertId: "ALT-1", label: "NOT_FRAUD", action: "APPROVE", decidedBy: "customer:otp", decidedAt: "2026-10-01", reason: null, followedAi: false, amount: 10 }], recommendations: {},
} as never;

test("investigator search groups results and flags blocklisted accounts", () => {
  const r = search(s, "budi");
  assert.deepEqual(r.groups.map((g) => g.kind), ["Customers", "Alerts"]);
  const acc = search(s, "ben-9").groups.find((g) => g.kind === "Beneficiary accounts")!.items[0];
  assert.equal(acc.risk, "HIGH");
  assert.equal(search(s, "x").total, 0); // too short
});

test("feedback summary counts sources and baseline false positives", () => {
  const f = feedback(s);
  assert.equal(f.summary.customerConfirmed, 1);
  assert.equal(f.summary.baselineFalsePositive, 1);
});
