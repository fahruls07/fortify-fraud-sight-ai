import { getStore } from "@/lib/store";
import { customerProfile } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = customerProfile(getStore(), (await params).id);
  return p ? Response.json(p) : Response.json({ error: "Customer not found." }, { status: 404 });
}
