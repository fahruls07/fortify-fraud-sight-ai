import { getStore } from "@/lib/store";
import { sessionDetail } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = sessionDetail(getStore(), (await params).id);
  return d ? Response.json(d) : Response.json({ error: "Session not found." }, { status: 404 });
}
