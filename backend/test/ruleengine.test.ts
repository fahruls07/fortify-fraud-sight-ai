import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRules } from "../lib/ruleengine.ts";

const r = (id: string, action: string, cond: object, status = "Active") => ({ id, name: id, action, severity: "HIGH", expression: "", status, condition: cond }) as never;
const f = { amount: 50_000_000, hourOfDay: 3, isNewBeneficiary: true, screenSharingAppDetected: "AnyDesk", isVpnDetected: false, ipCountry: "ID", copyPasteEventsOnBeneficiaryField: 0, deviceRooted: false, sharedDeviceWith: 0 } as never;

test("strictest active rule wins; drafts are ignored; ALLOW only when alone", () => {
  const rules = [r("A", "HOLD", { all: [{ field: "amount", op: ">", value: 1 }] }), r("B", "DECLINE", { all: [{ field: "screenSharingAppDetected", op: "isNotNull" }] }), r("C", "DECLINE", { all: [{ field: "amount", op: ">", value: 1 }] }, "Draft"), r("D", "ALLOW", { all: [{ field: "amount", op: ">", value: 1 }] })];
  const o = evaluateRules(rules, f);
  assert.equal(o.action, "DECLINE"); assert.deepEqual(o.hits.map((h) => h.id), ["A", "B", "D"]);
  assert.equal(evaluateRules([rules[3]], f).action, "ALLOW");
  assert.equal(evaluateRules([], f).action, null);
});
