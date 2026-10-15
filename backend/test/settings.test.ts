import { test } from "node:test";
import assert from "node:assert/strict";
import { config, createKey, publicConfig, revokeKey, updateSection, verifyKey } from "../lib/settings.ts";

test("secrets never leave publicConfig; empty secret keeps value; clear removes", () => {
  assert.equal(updateSection("notification", { smtp: { host: "smtp.bank.co.id", pass: "s3cret" } }), null);
  const p = publicConfig();
  assert.equal(p.config.notification.smtp.pass, "");
  assert.ok(p.secretsSet.includes("notification.smtp.pass"));
  assert.equal(updateSection("notification", { smtp: { pass: "" } }), null);
  assert.equal(config().notification.smtp.pass, "s3cret");
  assert.equal(updateSection("notification", {}, ["notification.smtp.pass"]), null);
  assert.equal(config().notification.smtp.pass, "");
});

test("validation", () => {
  assert.equal(typeof updateSection("general", { autoResolveHours: -1 }), "string");
  assert.equal(typeof updateSection("api", { webhookUrl: "ftp://x" }), "string");
  assert.equal(typeof updateSection("notification", { slack: { webhookUrl: "https://evil.example/x" } }), "string");
  assert.equal(typeof updateSection("notification", { smtp: { from: "a\r\nBcc: x@y.z" } }), "string");
  assert.equal(config().general.autoResolveHours, 0); // rejected update changed nothing
});

test("api keys: hash only, verify, revoke", () => {
  const { key, record } = createKey("IB prod", "admin");
  assert.ok(key.startsWith("fk_live_") && !("hash" in record));
  assert.equal(verifyKey(key), true);
  assert.equal(verifyKey(key + "x"), false);
  assert.equal(revokeKey(record.id), null);
  assert.equal(verifyKey(key), false);
});
