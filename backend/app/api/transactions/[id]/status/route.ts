import { errorResponse, transactionStatus } from "@/lib/transfers";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(transactionStatus((await params).id)); } catch (e) { return errorResponse(e); }
}
