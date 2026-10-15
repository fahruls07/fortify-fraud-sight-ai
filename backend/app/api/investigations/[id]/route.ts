import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const inv = getStore().investigations[(await params).id];
  return inv ? Response.json(inv) : Response.json({ error: "investigation not found" }, { status: 404 });
}
