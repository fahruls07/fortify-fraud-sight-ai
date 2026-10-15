import { rulePerformance } from "@/lib/ruleperf";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(rulePerformance(getStore()));
