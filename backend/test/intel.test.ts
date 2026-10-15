import { test } from "node:test";
import assert from "node:assert/strict";
import { amlScreen, listHits, nameScore, scoreEvent, validateListEntry } from "../lib/intel.ts";
import { addToCase, createCase, escalateDue, updateCase } from "../lib/cases.ts";

const base = () => ({
  watchlist: [] as never[], amlList: [{ id: "AML-1", name: "Viktor Petrov Antonov", type: "SANCTION", country: "RU", source: "", notes: "", createdBy: "", createdAt: "" }],
  customers: [{ id: "C1", name: "Budi", accountId: "ACC-1", usualDevice: "Pixel 7", homeCountry: "ID" }],
  transactions: [] as { customerId: string; createdAt: string; amount: number; id: string }[], events: [] as never[],
  alerts: [] as Record<string, unknown>[], cases: [] as never[], nextCaseSeq: 1,
}) as never as Parameters<typeof listHits>[0];

test("watchlist: account, beneficiary name, device, CIDR; expiry ignored", () => {
  const s = base() as unknown as { watchlist: unknown[] };
  const add = (b: Record<string, unknown>) => { const v = validateListEntry(b); assert.ok(typeof v !== "string", String(v)); s.watchlist.push({ ...(v as object), id: `W${s.watchlist.length}`, hits: 0, createdBy: "t", createdAt: "" }); };
  add({ list: "BLACK", type: "ACCOUNT", value: "acc-ben-9" }); add({ list: "BLACK", type: "IP", value: "10.1.0.0/16" });
  add({ list: "WHITE", type: "BENEFICIARY", value: "PT. Listrik  Negara" }); add({ list: "BLACK", type: "DEVICE", value: "old", expiresAt: "2000-01-01" });
  const h = listHits(s as never, { accounts: ["ACC-BEN-9"], beneficiaryName: "pt listrik negara", ip: "10.1.200.3", deviceId: "OLD" });
  assert.deepEqual([h.black.length, h.white.length], [2, 1]);
  assert.equal(listHits(s as never, { accounts: [], ip: "10.2.0.1" }).black.length, 0);
  assert.equal(typeof validateListEntry({ list: "BLACK", type: "IP", value: "999.1.1.1" }), "string");
});

test("AML: fuzzy name with titles/order/typo; structuring; high-risk country", () => {
  assert.ok(nameScore("Antonov, Viktor Petrov", "Viktor Petrov Antonov") === 1);
  assert.ok(nameScore("Victor Petrov Antonov", "Viktor Petrov Antonov") > 0.9);
  assert.ok(nameScore("Budi Santoso", "Viktor Petrov Antonov") < 0.5);
  const s = base() as unknown as { transactions: unknown[] };
  assert.equal(amlScreen(s as never, { beneficiaryName: "Mr. Viktor Petrov Antonov" }).hit, true);
  const now = new Date().toISOString();
  s.transactions.push({ id: "1", customerId: "C1", createdAt: now, amount: 95_000_000 }, { id: "2", customerId: "C1", createdAt: now, amount: 99_000_000 });
  const r = amlScreen(s as never, { customerId: "C1", amount: 97_000_000, ipCountry: "KP" });
  assert.ok(r.reasons.some((x) => /structuring/.test(x)) && r.reasons.some((x) => /high-risk/.test(x)));
});

test("login event scoring: new device + foreign IP + failures → DENY", () => {
  const r = scoreEvent(base(), { type: "login_attempt", customerId: "C1", sessionId: null, deviceId: "iPhone X", ip: null, ipCountry: "RU", success: false, failedAttempts: 3, change: null });
  assert.equal(r.decision, "DENY");
  assert.equal(scoreEvent(base(), { type: "login_attempt", customerId: "C1", sessionId: null, deviceId: "Pixel 7", ip: null, ipCountry: "ID", success: true, failedAttempts: 0, change: null }).decision, "ALLOW");
});

test("cases: create from alerts, merge, close needs resolution, SLA escalation", () => {
  const s = base() as unknown as { alerts: Record<string, unknown>[]; cases: { status: string; escalated: boolean }[] };
  const old = new Date(Date.now() - 10 * 3600e3).toISOString();
  s.alerts.push({ id: "A1", customerId: "C1", baselineLevel: "HIGH", status: "New", slaDueAt: old }, { id: "A2", customerId: "C1", baselineLevel: "LOW", status: "New" });
  const c = createCase(s as never, { alertIds: ["A1"] }, "sari");
  assert.ok(typeof c !== "string" && c.priority === "HIGH");
  assert.equal(typeof createCase(s as never, { alertIds: ["A1"] }, "sari"), "string"); // already in an open case
  assert.equal(addToCase(s as never, c as never, ["A2"], "sari"), null);
  assert.equal(typeof updateCase(s as never, c as never, { status: "CLOSED" }, "sari", ["sari"]), "string");
  const out = escalateDue(s as never, Date.now() + 5 * 3600e3);
  assert.deepEqual(out.map((x) => x.id).sort(), ["A1", (c as { id: string }).id].sort());
  assert.equal(s.cases[0].status, "ESCALATED");
  assert.equal(escalateDue(s as never, Date.now() + 6 * 3600e3).length, 0); // only once
});
