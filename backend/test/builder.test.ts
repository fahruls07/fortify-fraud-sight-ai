import { test } from "node:test";
import assert from "node:assert/strict";
import { chatBuild } from "../lib/copilot/builder.ts";

const say = (t: string) => [{ role: "user" as const, content: t }];

test("offline rule: Indonesian amounts, screen sharing, block; add keeps existing", async () => {
  const r = await chatBuild("rule", say("blokir transfer di atas 10 juta kalau ada screen sharing"), null, [], true);
  assert.equal(r.source, "offline");
  assert.ok(r.proposal && "expression" in r.proposal);
  assert.equal((r.proposal as { action: string }).action, "DECLINE");
  assert.match((r.proposal as { expression: string }).expression, /amount > 10000000/);
  const r2 = await chatBuild("rule", say("tambah juga kalau pakai VPN"), r.proposal, [], true);
  assert.match((r2.proposal as { expression: string }).expression, /amount > 10000000 && .*isVpnDetected == true/);
});

test("offline rule: unsupported signal is reported, not mis-mapped", async () => {
  const r = await chatBuild("rule", say("hold transfers over 5 million from a new device"), null, [], true);
  assert.doesNotMatch((r.proposal as { expression: string }).expression, /isNewBeneficiary/);
  assert.match(r.reply, /cannot check new device/);
});

test("offline workflow: criteria + AI + parallel actions, valid", async () => {
  const r = await chatBuild("workflow", say("transfer over 20 juta from a new device, ask AI, then block and notify the customer"), null, [], true);
  const w = r.proposal as { nodes: { type: string }[] };
  assert.deepEqual(w.nodes.map((n) => n.type), ["trigger", "criteria", "ai", "criteria", "parallel_action"]);
});

test("unclear request gets a question, no proposal", async () => {
  const r = await chatBuild("workflow", say("hello"), null, [], true);
  assert.equal(r.proposal, null);
});
