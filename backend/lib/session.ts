import { cookies } from "next/headers";
import { COOKIE, verifySession } from "./auth";
import { can, type Perm } from "./acm";

// Server components: current user and permission checks.
export const currentUser = async () => verifySession((await cookies()).get(COOKIE)?.value);
export const userCan = async (p: Perm) => { const u = await currentUser(); return !!u && can(u, p); };
