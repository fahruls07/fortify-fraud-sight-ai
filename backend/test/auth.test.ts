import { test } from "node:test";
import assert from "node:assert/strict";
import { login, register, signSession, verifySession } from "../lib/auth.ts";

test("session cookie round-trips, rejects tampering and expiry", () => {
  const { value } = signSession("ana.lis", 0);
  assert.equal(verifySession(value, 0), "ana.lis");
  assert.equal(verifySession(value.replace("ana.lis", "admin"), 0), null);
  assert.equal(verifySession(value, 9 * 3600 * 1000), null);
  assert.equal(verifySession("garbage", 0), null);
  assert.equal(verifySession(undefined), null);
});

test("dummy login and register with password confirmation", () => {
  assert.ok(login("sari", "fortify123"));
  assert.ok(!login("sari", "wrong"));
  assert.match(register("budi", "password1", "password2")!, /do not match/);
  assert.match(register("budi", "short", "short")!, /at least 8/);
  assert.match(register("Sari", "password1", "password1")!, /already taken/);
  assert.equal(register("budi", "password1", "password1"), null);
  assert.ok(login("BUDI", "password1"));
});
