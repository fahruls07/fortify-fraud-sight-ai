import { test } from "node:test";
import assert from "node:assert/strict";
import { makeZip, readZip } from "../lib/zip.ts";
import { exportPack, parsePack } from "../lib/rules/pack.ts";

test("zip round-trip", () => {
  const z = readZip(makeZip([{ name: "a.txt", data: Buffer.from("hello") }, { name: "d/b.json", data: Buffer.from("{}") }]));
  assert.equal(z.get("a.txt")!.toString(), "hello");
  assert.equal(z.get("d/b.json")!.toString(), "{}");
});

test("rejects non-zip input", () => {
  assert.throws(() => readZip(Buffer.from("not a zip")), /Not a ZIP/);
});

test("rule pack export → import, per-file validation", () => {
  const rule = { id: "RULE-0001", name: "Big transfer", description: "d", severity: "HIGH", condition: { all: [{ field: "amount", op: ">", value: 10000000 }] }, action: "HOLD", status: "Active", createdBy: "x", createdAt: "" };
  const ok = parsePack(exportPack([rule as never], "admin"));
  assert.ok("items" in ok && ok.items.length === 1 && ok.items[0].rule?.name === "Big transfer");
  const bad = parsePack(makeZip([{ name: "package.json", data: Buffer.from(JSON.stringify({ format: "fortify.rules/v1", rules: ["rules/x.json"] })) }, { name: "rules/x.json", data: Buffer.from("{\"name\":1}") }]));
  assert.ok("items" in bad && bad.items[0].error);
  assert.ok("errors" in parsePack(makeZip([{ name: "other.txt", data: Buffer.from("x") }])));
});
