import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ fallbackOnly: getStore().fallbackOnly });
}

// Body { "enabled": true|false }; empty body toggles.
export async function POST(req: Request) {
  const s = getStore();
  const body = await req.json().catch(() => ({}));
  s.fallbackOnly = typeof body.enabled === "boolean" ? body.enabled : !s.fallbackOnly;
  return Response.json({ fallbackOnly: s.fallbackOnly });
}
