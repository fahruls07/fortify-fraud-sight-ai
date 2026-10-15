import { register, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { username, password, confirm } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string" || typeof confirm !== "string")
    return Response.json({ error: "Username and password are required." }, { status: 400 });
  const err = register(username, password, confirm);
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": sessionCookie(username) } });
}
