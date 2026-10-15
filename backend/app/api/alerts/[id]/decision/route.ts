import { userFrom } from "@/lib/auth";
import { ApiError, decide, errorResponse } from "@/lib/transfers";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => { throw new ApiError(400, "body must be JSON"); });
    return Response.json(decide(id, body, userFrom(req)));
  } catch (e) { return errorResponse(e); }
}
