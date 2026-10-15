import type { Customer, Session } from "./types";

// 07 §5 thresholds; backend computes `anomalous` so the UI does no logic.
export function anomalyFlags(s: Session, c: Customer) {
  return {
    isVpnDetected: s.isVpnDetected === true,
    ipCountry: s.ipCountry !== c.homeCountry,
    screenSharingAppDetected: s.screenSharingAppDetected != null,
    copyPasteEventsOnBeneficiaryField: s.copyPasteEventsOnBeneficiaryField >= 3,
    hesitationTimeMs: s.hesitationTimeMs > 3000,
    typingCadenceDeviation: s.typingCadenceDeviation > 0.5,
    sessionDurationSec: s.sessionDurationSec > 5 * c.sessionBaseline.sessionDurationSec,
    deviceRooted: s.deviceRooted === true,
  };
}

// 02 §4/§5 response: grouped signals, value vs baseline, `anomalous` computed here so the UI (and M3 tools) do no logic.
// shortcut: deviceModel / isNewDevice / navigationPattern are never flagged, M7 §5 defines no threshold for them; add one there first.
export function signalsView(s: Session, c: Customer) {
  const a = anomalyFlags(s, c);
  const row = (field: keyof Session, baseline: string | number | boolean | null, anomalous = false) => ({ field, value: s[field], baseline, anomalous });
  const b = c.sessionBaseline;
  return {
    sessionId: s.id, customerId: s.customerId,
    groups: [
      { name: "Device intelligence", signals: [
        row("deviceModel", c.usualDevice), row("deviceRooted", false, a.deviceRooted), row("isVpnDetected", false, a.isVpnDetected),
        row("ipCountry", c.homeCountry, a.ipCountry), row("screenSharingAppDetected", null, a.screenSharingAppDetected), row("isNewDevice", null),
      ] },
      { name: "Behavioural biometrics", signals: [
        row("copyPasteEventsOnBeneficiaryField", 0, a.copyPasteEventsOnBeneficiaryField), row("hesitationTimeMs", b.hesitationTimeMs, a.hesitationTimeMs),
        row("typingCadenceDeviation", b.typingCadenceDeviation, a.typingCadenceDeviation), row("sessionDurationSec", b.sessionDurationSec, a.sessionDurationSec),
        row("navigationPattern", b.navigationPattern),
      ] },
    ],
  };
}
