import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matches, renderExpression, validateRule, type Features } from "../lib/rules/dsl.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../data/seed/fallbacks/${f}`, import.meta.url), "utf8"));
const base: Features = { amount: 0, hourOfDay: 12, isNewBeneficiary: false, screenSharingAppDetected: null, isVpnDetected: false, ipCountry: "ID", copyPasteEventsOnBeneficiaryField: 0, deviceRooted: false, sharedDeviceWith: 0 };

test("both canned rules validate and their stored expression matches the rendered one", () => {
  for (const f of ["rules-screen-sharing.json", "rules-night-new-account.json"]) {
    const raw = load(f), v = validateRule(raw);
    assert.ok("rule" in v, f);
    assert.equal(renderExpression(raw.condition), raw.expression);
  }
});
test("unknown field, bad operator and wrong value type are rejected", () => {
  const rule = load("rules-screen-sharing.json");
  const bad = (leaf: object) => validateRule({ ...rule, condition: { all: [leaf] } });
  assert.match((bad({ field: "creditScore", op: ">", value: 1 }) as any).error, /unknown field/);
  assert.match((bad({ field: "amount", op: "~", value: 1 }) as any).error, /operator/);
  assert.match((bad({ field: "amount", op: ">", value: "10" }) as any).error, /number/);
  assert.match((bad({ field: "isVpnDetected", op: ">", value: true }) as any).error, /numbers only/);
  assert.match((bad({ field: "amount", op: "isNotNull" }) as any).error, /nullable/);
});
test("exactly one of all/any is required", () => {
  const rule = load("rules-screen-sharing.json");
  assert.ok("error" in validateRule({ ...rule, condition: { all: rule.condition.all, any: rule.condition.all } }));
});
test("screen-sharing rule catches Budi's session and ignores a normal one", () => {
  const c = load("rules-screen-sharing.json").condition;
  assert.equal(matches(c, { ...base, amount: 50e6, screenSharingAppDetected: "AnyDesk" }), true);
  assert.equal(matches(c, { ...base, amount: 50e6 }), false);
  assert.equal(matches(c, { ...base, amount: 5e6, screenSharingAppDetected: "AnyDesk" }), false);
});
test("night rule needs hour 2-4, new beneficiary and > 10 jt", () => {
  const c = load("rules-night-new-account.json").condition;
  const hit = { ...base, amount: 20e6, hourOfDay: 3, isNewBeneficiary: true };
  assert.equal(matches(c, hit), true);
  assert.equal(matches(c, { ...hit, hourOfDay: 5 }), false);
  assert.equal(matches(c, { ...hit, isNewBeneficiary: false }), false);
});
