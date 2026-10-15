import { getStore } from "@/lib/store";
import { search } from "@/lib/views";

export const dynamic = "force-dynamic";

// Investigator: one query across customers, accounts, alerts, cases, devices, sessions, transactions and IPs.
export const GET = (req: Request) => Response.json(search(getStore(), (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100)));
