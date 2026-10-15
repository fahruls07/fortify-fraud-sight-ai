import { runTest } from "@/lib/integrations";

export const dynamic = "force-dynamic";

// Body: { target: smtp|slack|telegram|webhook|firestore|grafana|endpoint, arg? } — tests the SAVED settings.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  return Response.json(await runTest(String(b.target ?? ""), String(b.arg ?? "")));
}
