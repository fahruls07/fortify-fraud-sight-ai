import { accountGraph } from "@/lib/graph";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Connections graph + timeline for a beneficiary account, built from transaction history.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return Response.json(accountGraph(getStore(), decodeURIComponent((await params).id)));
}
