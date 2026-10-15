import { test } from "node:test";
import assert from "node:assert/strict";
import { accountGraph } from "../lib/graph.ts";

test("graph aggregates senders from history, marks fraud and blocklisted attributes, builds a timeline", () => {
  const ben = { accountId: "B1", bankName: "Bank X", name: "Mule Guy", isNew: true, accountAgeDays: 5 };
  const s = {
    customers: [{ id: "C1", name: "Ana", maskedAccount: "•••1", accountId: "A1", homeCountry: "ID" }, { id: "C2", name: "Bo", maskedAccount: "•••2", accountId: "A2", homeCountry: "ID" }],
    sessions: [{ id: "S1", deviceModel: "Pixel", ipCountry: "RU", isVpnDetected: true, deviceRooted: false, isNewDevice: true, screenSharingAppDetected: "AnyDesk" }],
    transactions: [
      { id: "T1", customerId: "C1", sessionId: "S1", amount: 1000, status: "DECLINED", createdAt: "2026-10-01T01:00:00Z", beneficiary: ben },
      { id: "T2", customerId: "C1", sessionId: null, amount: 500, status: "COMPLETED", createdAt: "2026-10-02T01:00:00Z", beneficiary: ben },
      { id: "T3", customerId: "C2", sessionId: null, amount: 200, status: "COMPLETED", createdAt: "2026-10-03T01:00:00Z", beneficiary: ben },
    ],
    alerts: [{ id: "AL1", transactionId: "T1", customerId: "C1", createdAt: "2026-10-01T01:00:01Z", baselineLevel: "HIGH", baselineScore: 80 }],
    decisions: [{ alertId: "AL1", action: "DECLINE", label: "FRAUD", decidedBy: "sari", decidedAt: "2026-10-01T02:00:00Z", amount: 1000 }],
    watchlist: [{ list: "BLACK", type: "DEVICE", value: "pixel", expiresAt: null, createdAt: "", createdBy: "x", reason: "" }],
    network: {},
  } as never;
  const g = accountGraph(s, "B1");
  const e1 = g.edges.find((e) => e.id === "tx:C1")!;
  assert.deepEqual([e1.amount, e1.count, e1.fraud], [1500, 2, true]);
  assert.equal(g.summary.senders, 2); assert.equal(g.summary.fraud, 1); assert.equal(g.summary.maxRisk, "HIGH");
  assert.ok(g.nodes.find((n) => n.id === "dev:Pixel")!.blocked);
  assert.ok(g.nodes.some((n) => n.id === "ip:RU"));
  assert.deepEqual(g.timeline.map((t) => t.kind).slice(0, 2), ["transfer", "transfer"]);
  assert.ok(g.timeline.some((t) => t.kind === "decision"));
});
