import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateReport } from "../lib/copilot/validate.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../data/seed/${f}`, import.meta.url), "utf8"));
const cached = load("fallbacks/budi-report.json");
const ctx = {
  codes: new Set<string>(load("reason-codes.json").map((r: any) => r.code)),
  docIds: new Set(["PB-SCAM-01", "PB-MULE-01", "POL-FRAUD-01"]),
  toolOutputs: { transaction: { amount: 1, beneficiary: { isNew: true, accountAgeDays: 9 } }, avgDailySpend: 1, networkLinks: { sharedDeviceWith: 3 },
    groups: [{ signals: ["screenSharingAppDetected", "copyPasteEventsOnBeneficiaryField", "isVpnDetected", "hesitationTimeMs"].map((field) => ({ field })) }] },
};
const withChange = (patch: object) => validateReport({ ...cached, ...patch }, ctx);

test("cached Budi report passes", () => assert.ok("report" in validateReport(cached, ctx)));
test("unknown reason code is rejected", () => assert.match((withChange({ reasonCodes: [{ ...cached.reasonCodes[0], code: "RC_MADE_UP" }] }) as any).error, /catalog/));
test("evidence without a tool field is rejected", () => assert.match((withChange({ reasonCodes: [{ ...cached.reasonCodes[0], evidence: "looks suspicious" }] }) as any).error, /evidence/));
test("headline over 140 chars is rejected", () => assert.match((withChange({ headline: "x".repeat(141) }) as any).error, /headline/));
test("citation to unknown doc is rejected", () => assert.match((withChange({ citations: [{ docId: "NOPE", title: "t" }] }) as any).error, /citations/));
