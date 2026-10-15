import { errorResponse, verifyChallenge } from "@/lib/transfers";

export const dynamic = "force-dynamic";

// Banking app: the customer enters the OTP sent for a challenged transfer.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(verifyChallenge((await params).id, await req.json().catch(() => ({})))); } catch (e) { return errorResponse(e); }
}
