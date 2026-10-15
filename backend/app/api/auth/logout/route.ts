import { COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
