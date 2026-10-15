import { can } from "@/lib/acm";
import { login, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string" || !login(username, password))
    return Response.json({ error: "Incorrect username or password." }, { status: 401 });
  if (!can(username.trim().toLowerCase(), null)) return Response.json({ error: "This account is disabled. Contact your administrator." }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(username) } });
}
