import { amlScreen } from "@/lib/intel";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Manual name screening against the AML lists (read-only).
export async function POST(req: Request) {
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || name.trim().length < 3 || name.length > 120) return Response.json({ error: "Enter a name (3–120 characters)." }, { status: 400 });
  return Response.json(amlScreen(getStore(), { customerName: name }));
}
