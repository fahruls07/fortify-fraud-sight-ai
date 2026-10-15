import { executeFlow } from "@/lib/flows";
import { errorResponse } from "@/lib/transfers";

export const dynamic = "force-dynamic";

// Banking channel: run a published workflow. Only the outcome goes back; variables and fired actions stay internal.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { variables, actions, ...out } = await executeFlow((await params).slug, await req.json().catch(() => ({}))); // eslint-disable-line @typescript-eslint/no-unused-vars
    return Response.json(out);
  } catch (e) { return errorResponse(e); }
}
