import { backtest } from "@/lib/rules/backtest";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = getStore();
  const { id } = await params;
  const rule = s.rules.find((r) => r.id === id);
  return rule ? Response.json(backtest(s, rule)) : Response.json({ error: "rule not found" }, { status: 404 });
}
