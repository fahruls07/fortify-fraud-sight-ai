import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("entityId");
  return Response.json(getStore().audit.filter((e) => !id || e.entityId === id).reverse());
}
