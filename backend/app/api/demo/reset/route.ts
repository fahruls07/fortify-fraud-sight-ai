import { reset } from "@/lib/store";

export const dynamic = "force-dynamic";

export function POST() {
  const s = reset();
  return Response.json({ ok: true, customers: s.customers.length, transactions: s.transactions.length, alerts: s.alerts.length, fallbackOnly: s.fallbackOnly });
}
