import { getAccess } from "@/lib/acm";
import { listUsers } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Active users (username + display name) for assignee pickers. Any signed-in user.
export const GET = () => Response.json(listUsers().map((u) => ({ username: u, name: getAccess(u).name ?? u, active: getAccess(u).active })).filter((u) => u.active));
