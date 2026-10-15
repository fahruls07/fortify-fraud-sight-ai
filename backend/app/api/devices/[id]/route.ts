import { getStore } from "@/lib/store";
import { deviceDetail } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = deviceDetail(getStore(), decodeURIComponent((await params).id));
  return d ? Response.json(d) : Response.json({ error: "Device not found." }, { status: 404 });
}
