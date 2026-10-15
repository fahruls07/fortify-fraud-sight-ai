import { test } from "node:test";
import assert from "node:assert/strict";
import { toastLabel } from "../lib/toastlabels.ts";

test("mutations get specific labels; reads, chats, tests and previews are silent", () => {
  assert.equal(toastLabel("POST", "/api/alerts/ALT-1/decision"), "Decision saved");
  assert.equal(toastLabel("DELETE", "/api/rules/RULE-0001"), "Rule deleted");
  assert.equal(toastLabel("PUT", "/api/rules/RULE-0001"), "Rule saved");
  assert.equal(toastLabel("POST", "/api/workflows/wf_001/deploy"), "Workflow deployed");
  assert.equal(toastLabel("PUT", "/api/settings/config"), "Settings saved");
  assert.equal(toastLabel("GET", "/api/rules"), null);
  assert.equal(toastLabel("POST", "/api/copilot/chat"), null);
  assert.equal(toastLabel("POST", "/api/workflows/draft/test"), null);
  assert.equal(toastLabel("POST", "/api/settings/config/test"), null);
  assert.equal(toastLabel("POST", "/api/graphql", '{"query":"query GetAlerts { alerts { id } }"}'), null);
  assert.equal(toastLabel("POST", "/api/graphql", '{"query":"mutation Ack($id: ID!) { acknowledgeAlert(id: $id) { id } }"}'), "Alert acknowledged");
});
