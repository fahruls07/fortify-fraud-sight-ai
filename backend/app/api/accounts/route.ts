import { accountIndex } from "@/lib/graph";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Beneficiary accounts that have a connections graph, riskiest first.
export const GET = () => Response.json(accountIndex(getStore()));
