import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getStore().customers.find((x) => x.id === id);
  return c ? Response.json(c) : Response.json({ error: "customer not found" }, { status: 404 });
}
