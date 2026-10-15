# Fortify — PRD M5: Network Graph

**Priority:** P1 · **Build depth:** Visual on mock links (~50%) · **Demo beat:** supporting panel inside M3 report

## 1. Goal
Show that the beneficiary is not a lone account but part of a mule network, visually and in one glance. Adds the "wow" and gives the Copilot one more piece of evidence.

## 2. Principle
No graph database. Backend returns a small mock subgraph per account; frontend renders it with React Flow (or D3 force layout). Same data feeds the `get_network_links` tool in M3.

## 3. User stories
- As Sari, I see the beneficiary account at the centre, linked to other accounts by shared device / transfers.
- As Sari, accounts already flagged as fraud are visually distinct.
- As Sari, the Copilot report mentions the network finding and links to this panel.

## 4. Data

```json
{
  "centerAccountId": "ACC-BEN-7781",
  "linkedAccountsCount": 15,
  "sharedDeviceWith": 3,
  "nodes": [
    { "id": "ACC-BEN-7781", "label": "Rekening Tujuan", "type": "beneficiary", "flagged": false },
    { "id": "ACC-M-01", "label": "•••4412", "type": "account", "flagged": true }
  ],
  "edges": [
    { "source": "ACC-BEN-7781", "target": "ACC-M-01", "type": "SHARED_DEVICE" },
    { "source": "ACC-M-04", "target": "ACC-BEN-7781", "type": "TRANSFER", "amount": 4800000 }
  ]
}
```

For Budi's beneficiary: 1 centre + 6–8 visible neighbours; 3 linked by SHARED_DEVICE and flagged as fraud in the last 7 days; others linked by inbound TRANSFER (fan-in pattern). Budi's own account appears as a sender node.

## 5. UI
- Panel titled "Jaringan Rekening Tujuan" on Alert Detail, collapsed by default, auto-expands after the Copilot report mentions RC_MULE_NETWORK.
- Node colours: centre (accent), flagged (red), normal (grey), customer (blue). Edge style: dashed = shared device, solid = transfer.
- Legend and a single stat line: "15 rekening terhubung · 3 berbagi perangkat · 3 ditandai fraud".
- No editing; drag/zoom only.

## 6. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/accounts/{id}/network` | Mock subgraph |

## 7. Acceptance criteria
- Graph renders in < 1 s with readable labels at laptop resolution.
- Copilot report for Budi includes the sentence pattern: beneficiary shares a device with 3 accounts recently flagged as fraud.
- Low-risk seed alert returns an empty or trivial graph.

## 8. Out of scope
Graph traversal, ring detection algorithms, multi-hop expansion.
