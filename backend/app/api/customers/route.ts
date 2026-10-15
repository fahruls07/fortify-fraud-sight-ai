import { getStore } from "@/lib/store";
import { customerList } from "@/lib/views";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(customerList(getStore()));
