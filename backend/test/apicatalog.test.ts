import { test } from "node:test";
import assert from "node:assert/strict";
import { consoleSpec } from "../lib/apicatalog.ts";

test("console spec is generated from the route files with permissions", () => {
  const s = consoleSpec() as { paths: Record<string, Record<string, { "x-permission": string; summary: string }>> };
  assert.equal(s.paths["/api/rules"].get["x-permission"], "rules.view");
  assert.equal(s.paths["/api/rules/{id}"].delete["x-permission"], "rules.manage");
  assert.equal(s.paths["/api/auth/login"].post["x-permission"], "public");
  assert.ok(!Object.keys(s.paths).some((p) => p.startsWith("/api/transactions/")), "banking endpoints live in the banking spec");
  for (const ops of Object.values(s.paths)) for (const [m, o] of Object.entries(ops)) assert.ok(!o.summary.startsWith(m.toUpperCase() + " /"), `missing summary: ${m} ${JSON.stringify(o.summary)}`);
});
