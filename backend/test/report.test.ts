import { test } from "node:test";
import assert from "node:assert/strict";
import { filterAlerts, toExcelXml } from "../lib/report.ts";

test("excel xml escapes and types cells", () => {
  const x = toExcelXml([{ name: "S", rows: [{ a: "<b&>", n: 5 }] }]);
  assert.match(x, /&lt;b&amp;&gt;/);
  assert.match(x, /ss:Type="Number">5</);
});

test("filter by period (Jakarta date, inclusive) and alert id", () => {
  const s = { alerts: [{ id: "ALT-001", createdAt: "2026-10-01T18:00:00Z" }, { id: "ALT-002", createdAt: "2026-10-03T01:00:00Z" }] } as never;
  assert.deepEqual(filterAlerts(s, { from: "2026-10-02", to: "2026-10-03" }).map((a) => a.id), ["ALT-002", "ALT-001"]); // 18:00Z = 01:00 WIB on 10-02
  assert.deepEqual(filterAlerts(s, { alertId: "alt-002" }).map((a) => a.id), ["ALT-002"]);
});
