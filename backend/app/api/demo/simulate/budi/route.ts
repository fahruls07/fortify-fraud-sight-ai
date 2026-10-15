import { errorResponse, simulateBudi } from "@/lib/transfers";

export const dynamic = "force-dynamic";

export function POST() {
  try { return Response.json(simulateBudi()); } catch (e) { return errorResponse(e); }
}
