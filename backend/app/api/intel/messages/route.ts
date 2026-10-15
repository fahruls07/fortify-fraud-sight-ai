import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(getStore().messages);
