import { generateRule } from "@/lib/rules/generate";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { prompt } = await req.json().catch(() => ({}));
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 500) return Response.json({ error: "prompt (1-500 chars) is required" }, { status: 400 });
  try { return Response.json(await generateRule(getStore(), prompt)); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: (e as { status?: number }).status ?? 500 }); }
}
