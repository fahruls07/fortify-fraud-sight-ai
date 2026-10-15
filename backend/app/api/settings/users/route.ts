import { getAccess, pendingFor } from "@/lib/acm";
import { lastLogin, listUsers } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(listUsers().map((u) => ({ username: u, ...getAccess(u), lastLogin: lastLogin(u), pending: pendingFor(u)?.id ?? null })));
