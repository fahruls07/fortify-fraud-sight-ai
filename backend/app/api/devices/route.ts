import { getStore } from "@/lib/store";
import { devices } from "@/lib/views";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(devices(getStore()));
