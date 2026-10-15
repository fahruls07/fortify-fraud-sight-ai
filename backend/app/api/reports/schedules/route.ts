import { userFrom } from "@/lib/auth";
import { nextRun, validateSchedule, type Schedule } from "@/lib/schedules";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = () => Response.json(getStore().reportSchedules);

export async function POST(req: Request) {
  const v = validateSchedule(await req.json().catch(() => ({})));
  if (typeof v === "string") return Response.json({ error: v }, { status: 400 });
  const s = getStore();
  const sc: Schedule = { ...v, id: `SCH-${String(s.nextSchedSeq++).padStart(3, "0")}`, createdBy: userFrom(req), createdAt: new Date().toISOString(), nextRunAt: nextRun(v.frequency) };
  s.reportSchedules.push(sc);
  return Response.json(sc, { status: 201 });
}
