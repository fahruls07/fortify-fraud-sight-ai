import { getStore } from "@/lib/store";
import { feedback } from "@/lib/views";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(feedback(getStore()));
