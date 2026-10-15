import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params;
  const d = getStore().kb.find((x) => x.docId === docId);
  return d ? Response.json(d) : Response.json({ error: "document not found" }, { status: 404 });
}
