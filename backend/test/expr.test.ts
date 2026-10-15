import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../lib/expr.ts";

test("arithmetic, precedence, functions, variables", () => {
  assert.equal(compile("1 + 2 * 3").run({}), 7);
  assert.equal(compile("-(2 + 3) * 2").run({}), -10);
  assert.equal(compile("round(amount / avg_daily_spend)").run({ amount: 50, avg_daily_spend: 4 }), 13);
  assert.equal(compile("max(score, 10) + new_device * 5").run({ score: 3, new_device: true }), 15);
  assert.deepEqual(compile("a + b * min(c, 2)").vars, ["a", "b", "c"]);
});

test("rejects unsafe or broken input", () => {
  for (const bad of ["process.exit()", "a;b", "1 +", "foo(1)", "x[0]", "'a'"]) {
    assert.throws(() => compile(bad).run({ x: 1, a: 1, b: 1 }), Error, bad);
  }
  assert.throws(() => compile("1 / 0").run({}), /finite/);
  assert.throws(() => compile("missing + 1").run({}), /not a number/);
});

test("prototype properties are not variables", () => {
  assert.throws(() => compile("constructor + 1").run({}), /not a number/);
  assert.throws(() => compile("toString").run({}), /not a number/);
});
