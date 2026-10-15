import { assistant, type Msg } from "@/lib/copilot/assistant";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const m = Array.isArray(b.messages) ? b.messages : [];
  if (!m.length || m.length > 30 || m.some((x: Msg) => (x?.role !== "user" && x?.role !== "assistant") || typeof x.content !== "string" || x.content.length > 2000) || m.at(-1).role !== "user")
    return Response.json({ error: "messages must be 1–30 {role, content ≤ 2000 chars}, ending with the user" }, { status: 400 });
  return Response.json(await assistant(getStore(), m));
}
