import { startInvestigation } from "@/lib/copilot/orchestrator";
import { userFrom } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = getStore();
  const { id } = await params;
  const alert = s.alerts.find((a) => a.id === id);
  if (!alert) return Response.json({ error: "alert not found" }, { status: 404 });
  alert.assignedTo ||= userFrom(req); // first analyst to open the investigation takes the alert
  return Response.json({ investigationId: startInvestigation(s, id).id });
}
