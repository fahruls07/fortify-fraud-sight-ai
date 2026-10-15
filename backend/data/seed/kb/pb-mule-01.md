---
docId: PB-MULE-01
title: Playbook — Mule Account
tags: RC_MULE_NETWORK, RC_YOUNG_BENEFICIARY_ACCOUNT, RC_NEW_BENEFICIARY
---
# Mule Account

Mule accounts are usually newly opened (< 30 days), receive many incoming transfers from different senders (fan-in), then quickly move funds out. Several mules share the same device.

**Indicators:** account age < 30 days; shares a device with accounts flagged as fraud in the last 7 days; fan-in pattern of incoming transfers.

**Decision:** sharing a device with ≥ 2 fraud accounts = HIGH minimum. Action: decline the transfer, report the beneficiary account to the mule investigation team.
