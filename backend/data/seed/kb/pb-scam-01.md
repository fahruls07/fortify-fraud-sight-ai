---
docId: PB-SCAM-01
title: Playbook — Social Engineering / Screen-Sharing Scam
tags: RC_SCREEN_SHARING, RC_COPY_PASTE_BENEFICIARY, RC_VPN_FOREIGN_IP, RC_HESITATION, RC_TYPING_ANOMALY, RC_LONG_SESSION
---
# Social Engineering / Screen-Sharing Scam

The scammer contacts the customer (posing as bank staff, a courier, or an investment offer), asks them to install a remote access app (AnyDesk, TeamViewer), then guides the customer or controls the screen so the customer enters the PIN and confirms the transfer themselves. Device and PIN are valid, so transaction-only rules often rate it Medium.

**Strong indicators:** screen sharing app active; account number pasted (copy-paste ≥ 3 times); VPN or foreign IP on a known device; hesitation > 3000 ms; abnormal typing rhythm; session much longer than usual; direct navigation to the transfer menu.

**Decision:** screen sharing active + amount > Rp 10 million + new beneficiary = CRITICAL. Action: DECLINE_AND_FREEZE, contact the customer via the official channel (14041), educate the customer.
