import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = getStore();
  const { id } = await params;
  const alert = s.alerts.find((a) => a.id === id);
  if (!alert) return Response.json({ error: "alert not found" }, { status: 404 });
  const transaction = s.transactions.find((t) => t.id === alert.transactionId)!;
  const investigationId = Object.values(s.investigations).filter((i) => i.alertId === id).at(-1)?.id ?? null; // latest, so a reload finds the report
  return Response.json({ alert, transaction, customerId: alert.customerId, investigationId });
}
