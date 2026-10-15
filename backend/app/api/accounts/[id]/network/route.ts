import { networkFor } from "@/lib/network";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return Response.json(networkFor(getStore(), (await params).id));
}
