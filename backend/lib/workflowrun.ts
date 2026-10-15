import { networkFor } from "./network";
import type { State } from "./store";
import type { Customer, Session, Transaction } from "./types";
import type { Hit, RiskEvent } from "./intel.ts";
import { deployed, runWorkflow, type TestEvent } from "./workflows.ts";
import { services } from "./wfservices.ts";

const MAX_RUNS = 500;
const hourWib = (iso: string) => (new Date(iso).getUTCHours() + 7) % 24;

export function eventOf(s: State, tx: Transaction, c: Customer, ses: Session, hits: Hit[] = []): TestEvent {
  return {
    event: "transaction_created", source: tx.channel === "INTERNET_BANKING" ? "internet_banking" : "mobile_app",
    fields: {
      amount: tx.amount, hour_of_day: hourWib(tx.createdAt), avg_daily_spend: c.avgDailySpend, beneficiary_age_days: tx.beneficiary.accountAgeDays,
      velocity: s.transactions.filter((t) => t.customerId === c.id && t.createdAt <= tx.createdAt && Date.parse(tx.createdAt) - Date.parse(t.createdAt) < 3600e3).length,
      copy_paste: ses.copyPasteEventsOnBeneficiaryField, shared_device_with: networkFor(s, tx.beneficiary.accountId).sharedDeviceWith,
      new_device: ses.isNewDevice, geo_anomaly: ses.ipCountry !== c.homeCountry, new_beneficiary: tx.beneficiary.isNew, vpn: ses.isVpnDetected, rooted: ses.deviceRooted,
      screen_sharing: !!ses.screenSharingAppDetected, ip_country: ses.ipCountry, channel: tx.channel, customer_id: c.id, beneficiary_account: tx.beneficiary.accountId,
      failed_attempts: ses.failedPinAttempts, pin_correct: ses.pinCorrect && ses.failedPinAttempts === 0, login_success: true, recent_new_device_login: false, change_type: "", beneficiary_name: tx.beneficiary.name, customer_name: c.name,
      on_blacklist: hits.some((h) => h.kind === "BLACKLIST"), on_whitelist: hits.some((h) => h.kind === "WHITELIST"),
    },
  };
}

// Login / account-update events: same shadow run, with the event fields that exist (transfer fields are 0 / empty).
export function eventFromRisk(s: State, e: RiskEvent, c: Customer): TestEvent {
  return {
    event: e.type, source: "mobile_app",
    fields: {
      amount: 0, velocity: s.events.filter((x) => x.customerId === c.id && Date.now() - Date.parse(x.at) < 3600e3).length, hour_of_day: hourWib(e.at), avg_daily_spend: c.avgDailySpend,
      beneficiary_age_days: 0, copy_paste: 0, shared_device_with: 0, new_device: !!e.deviceId && e.deviceId !== c.usualDevice, geo_anomaly: !!e.ipCountry && e.ipCountry !== c.homeCountry,
      new_beneficiary: false, vpn: false, rooted: false, screen_sharing: false, failed_attempts: e.failedAttempts, pin_correct: e.success !== false && e.failedAttempts === 0,
      login_success: e.success !== false, recent_new_device_login: s.events.some((x) => x.id !== e.id && x.customerId === c.id && x.type === "login_attempt" && Date.now() - Date.parse(x.at) < 3600e3 && x.reasons.includes("unrecognised device")), change_type: e.change ?? "",
      on_blacklist: e.hits.some((h) => h.kind === "BLACKLIST"), on_whitelist: e.hits.some((h) => h.kind === "WHITELIST"),
      ip_country: e.ipCountry ?? c.homeCountry, channel: "MOBILE_APP", customer_id: c.id, beneficiary_account: "", beneficiary_name: "", customer_name: c.name,
    },
  };
}
export const runOnEvent = (s: State, e: RiskEvent, c: Customer) => runAll(s, eventFromRisk(s, e, c), e.id);

// Shadow execution: every Active workflow's DEPLOYED version runs on each new transfer, in the background.
// Fired actions are only recorded (run log, metrics); they never change the scoring decision or move money.
export const runOnTransfer = (s: State, tx: Transaction, c: Customer, ses: Session, hits: Hit[] = []) => runAll(s, eventOf(s, tx, c, ses, hits), tx.id);

function runAll(s: State, ev: TestEvent, ref: string) {
  for (const w of s.workflows) {
    const def = w.status === "Active" ? deployed(w) : undefined;
    if (!def) continue;
    const t0 = performance.now(), at = new Date().toISOString();
    runWorkflow(def, ev, services())
      .then((r) => ({ ok: !r.errors.length, fired: r.fired.map((f) => f.action), error: r.errors[0] }))
      .catch((e: Error) => ({ ok: false, fired: [] as string[], error: e.message }))
      .then((r) => {
        w.runs.push({ at, ms: +(performance.now() - t0).toFixed(3), ok: r.ok, fired: r.fired, ...(r.error && { error: r.error }), ref });
        if (w.runs.length > MAX_RUNS) w.runs.splice(0, w.runs.length - MAX_RUNS);
      });
  }
}
