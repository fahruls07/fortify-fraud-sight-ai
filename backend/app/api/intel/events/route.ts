import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams, type = q.get("type"), decision = q.get("decision");
  return Response.json(getStore().events.filter((e) => (!type || e.type === type) && (!decision || e.decision === decision)).slice(0, 2000));
}
