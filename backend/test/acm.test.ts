import { test } from "node:test";
import assert from "node:assert/strict";
import { can, decideRequest, getAccess, requiredPerm, submitRequest } from "../lib/acm.ts";

test("route → permission map", () => {
  assert.equal(requiredPerm("POST", "/api/alerts/ALT-001/decision"), "alerts.decide");
  assert.equal(requiredPerm("GET", "/alerts/ALT-001"), "alerts.view");
  assert.equal(requiredPerm("PUT", "/api/rules/RULE-0001"), "rules.manage");
  assert.equal(requiredPerm("POST", "/api/rules/RULE-0001/activate"), "rules.activate");
  assert.equal(requiredPerm("GET", "/api/reports", "?type=alerts&format=xls"), "reports.export");
  assert.equal(requiredPerm("POST", "/api/settings/requests/ACR-0001/approve"), "settings.checker");
  assert.equal(requiredPerm("GET", "/"), "dashboard.view");
  assert.equal(requiredPerm("GET", "/api/me"), null);
});

test("maker-checker: change applies only after a different user approves", () => {
  assert.equal(can("newbie", "reports.view"), false);
  assert.equal(typeof submitRequest("newbie", { type: "UPDATE_ACCESS", target: "newbie", perms: ["reports.view"], active: true }), "string"); // own access
  const r = submitRequest("sari", { type: "CREATE_USER", target: "newbie", password: "secret123", name: "New Bie", email: "newbie@bank.co.id", perms: ["dashboard.view", "reports.view"], active: true });
  assert.ok(typeof r !== "string");
  assert.equal(can("newbie", "reports.view"), false); // still pending
  assert.equal(typeof decideRequest("sari", r.id, true), "string"); // maker cannot check
  assert.ok(typeof decideRequest("supervisor", r.id, true) !== "string");
  assert.equal(can("newbie", "reports.view"), true);
  assert.deepEqual(getAccess("newbie").perms, ["dashboard.view", "reports.view"]);
});

test("delete user via maker-checker", () => {
  const r = submitRequest("sari", { type: "DELETE_USER", target: "newbie" });
  assert.ok(typeof r !== "string");
  assert.ok(typeof decideRequest("supervisor", r.id, true) !== "string");
  assert.equal(typeof submitRequest("sari", { type: "UPDATE_ACCESS", target: "newbie", perms: [], active: true }), "string"); // gone
});

test("role preset overrides perms; role derived for display", () => {
  const r = submitRequest("sari", { type: "CREATE_USER", target: "viewer1", password: "secret123", name: "V One", email: "v1@bank.co.id", role: "VIEWER", perms: ["settings.config"], active: true });
  assert.ok(typeof r !== "string");
  assert.ok(typeof decideRequest("supervisor", r.id, true) !== "string");
  const a = getAccess("viewer1");
  assert.equal(a.role, "VIEWER");
  assert.equal(a.perms.includes("settings.config" as never), false);
  assert.equal(getAccess("admin").role, "ADMIN");
});
