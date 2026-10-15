---
docId: POL-FRAUD-01
title: Bank Fraud Policy — Thresholds and Required Actions
tags: RC_AMOUNT_SPIKE, RC_SCREEN_SHARING, RC_MULE_NETWORK, RC_NEW_BENEFICIARY, RC_COPY_PASTE_BENEFICIARY, RC_VPN_FOREIGN_IP
---
# Bank Fraud Policy

1. Transfers with a baseline score ≥ 30 must be held (HOLD) before funds leave.
2. Score 0–29 LOW (ALLOW), 30–59 MEDIUM (HOLD), ≥ 60 HIGH (HOLD).
3. An active screen sharing app on a transfer > Rp 10,000,000 requires DECLINE; if combined with a new beneficiary or mule network, DECLINE_AND_FREEZE is required.
4. Beneficiary accounts sharing a device with ≥ 2 fraud accounts (7 days) must be declined.
5. AI recommendations are advisory; the final decision rests with the fraud analyst and is recorded in the audit log.
6. Customers whose accounts are frozen are contacted via the official channel 14041.
