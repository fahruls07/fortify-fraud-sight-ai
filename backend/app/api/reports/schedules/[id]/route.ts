import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, s = getStore(), i = s.reportSchedules.findIndex((x) => x.id === id);
  if (i < 0) return Response.json({ error: "Schedule not found." }, { status: 404 });
  s.reportSchedules.splice(i, 1);
  return Response.json({ ok: true });
}
