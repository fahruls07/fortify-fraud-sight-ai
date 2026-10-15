import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateRule, type Condition } from "../lib/rules/dsl.ts";
import { toGraph, toRule, type WfNode } from "../lib/rules/workflow.ts";

const seed = JSON.parse(readFileSync(new URL("../data/seed/rules.json", import.meta.url), "utf8"));

test("every dummy rule validates and round-trips through the workflow graph", () => {
  for (const r of seed) {
    assert.ok("rule" in validateRule(r), r.name);
    const g = toGraph(r.condition as Condition, r.action);
    const back = toRule(g.nodes, g.edges);
    assert.ok(!("error" in back), r.name);
    assert.deepEqual({ condition: back.condition, action: back.action }, { condition: r.condition, action: r.action }, r.name);
  }
});

test("broken graphs are rejected with a reason", () => {
  const { nodes, edges } = toGraph({ all: [{ field: "amount", op: ">", value: 1 }, { field: "deviceRooted", op: "==", value: true }] }, "HOLD");
  assert.match((toRule(nodes, edges.slice(1)) as { error: string }).error, /Connect Trigger/);
  assert.match((toRule(nodes, edges.filter((e) => e.target !== "action")) as { error: string }).error, /exactly one/);
  const stray: WfNode = { id: "x", type: "condition", position: { x: 0, y: 0 }, data: { field: "isVpnDetected", op: "==", text: "true" } };
  assert.match((toRule([...nodes, stray], edges) as { error: string }).error, /not connected/);
  assert.match((toRule(nodes.filter((n) => n.type !== "action"), edges) as { error: string }).error, /Action/);
});
