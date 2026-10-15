import { signalsView } from "@/lib/signals";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getStore();
  const ses = s.sessions.find((x) => x.id === id);
  const c = ses && s.customers.find((x) => x.id === ses.customerId);
  return ses && c ? Response.json(signalsView(ses, c)) : Response.json({ error: "session not found" }, { status: 404 });
}
