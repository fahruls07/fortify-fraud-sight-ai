import { runSchedule } from "@/lib/schedules";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// "Run now": sends the scheduled report immediately; the regular schedule is unchanged.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, sc = getStore().reportSchedules.find((x) => x.id === id);
  if (!sc) return Response.json({ error: "Schedule not found." }, { status: 404 });
  return Response.json(await runSchedule(sc));
}
