import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRun, periodFor } from "../lib/schedules.ts";
import { parseRecipients } from "../lib/mailer.ts";
import { toCsv } from "../lib/report.ts";

test("next run: daily, next Monday, 1st of month (07:00 WIB = 00:00 UTC)", () => {
  const wed = new Date("2026-10-14T10:00:00Z"); // Wednesday
  assert.equal(nextRun("daily", wed), "2026-10-15T00:00:00.000Z");
  assert.equal(nextRun("weekly", wed), "2026-10-19T00:00:00.000Z");
  assert.equal(nextRun("monthly", wed), "2026-11-01T00:00:00.000Z");
  assert.deepEqual(periodFor("weekly", new Date("2026-10-19T00:00:00Z")), { from: "2026-10-12", to: "2026-10-18" });
});

test("recipients: split, dedupe, validate", () => {
  assert.deepEqual(parseRecipients("a@x.co; B@x.co, a@x.co"), ["a@x.co", "b@x.co"]);
  assert.equal(typeof parseRecipients("not-an-email"), "string");
  assert.equal(typeof parseRecipients("a@x.co\r\nBcc: evil@x.co"), "string");
  assert.equal(typeof parseRecipients(""), "string");
});

test("csv quotes and neutralises formulas", () => {
  const c = toCsv([{ a: "x,y", b: "=HYPERLINK(1)", n: 5 }]);
  assert.equal(c, '﻿a,b,n\r\n"x,y","\'=HYPERLINK(1)",5');
});
