import { chatBuild, type Msg } from "@/lib/copilot/builder";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Body: { kind: "rule"|"workflow", messages: [{role, content}], current?: the definition on screen }
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (b.kind !== "rule" && b.kind !== "workflow") return Response.json({ error: "kind must be rule or workflow" }, { status: 400 });
  const msgs = Array.isArray(b.messages) ? b.messages : [];
  if (!msgs.length || msgs.length > 30 || msgs.some((m: Msg) => (m?.role !== "user" && m?.role !== "assistant") || typeof m.content !== "string" || m.content.length > 2000) || msgs.at(-1).role !== "user")
    return Response.json({ error: "messages must be 1–30 {role, content ≤ 2000 chars}, ending with the user" }, { status: 400 });
  if (JSON.stringify(b.current ?? null).length > 200_000) return Response.json({ error: "current definition is too large" }, { status: 413 });
  const s = getStore();
  return Response.json(await chatBuild(b.kind, msgs, b.current ?? null, s.rules, s.fallbackOnly));
}
