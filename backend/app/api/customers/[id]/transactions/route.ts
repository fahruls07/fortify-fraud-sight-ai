import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getStore();
  if (!s.customers.some((c) => c.id === id)) return Response.json({ error: "customer not found" }, { status: 404 });
  const raw = new URL(req.url).searchParams.get("limit") ?? "10";
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return Response.json({ error: "limit must be an integer 1-100" }, { status: 400 });
  const txs = s.transactions.filter((t) => t.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return Response.json(txs);
}
