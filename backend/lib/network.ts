import type { State } from "./store";
import type { Network } from "./types";

// Single source for the M5 endpoint and the M3 get_network_links tool. Unknown accounts get a trivial graph (05 §7).
export function networkFor(s: State, accountId: string): Network {
  return s.network[accountId] ?? {
    centerAccountId: accountId, linkedAccountsCount: 0, sharedDeviceWith: 0,
    nodes: [{ id: accountId, label: "Beneficiary Account", type: "beneficiary", flagged: false }], edges: [],
  };
}
