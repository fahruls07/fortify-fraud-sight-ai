import { readAttachment } from "@/lib/cases";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Always a download with a neutral type, so an uploaded HTML/SVG can never run in the console's origin.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, a = getStore().attachments.find((x) => x.id === id);
  if (!a) return Response.json({ error: "Attachment not found." }, { status: 404 });
  return new Response(new Uint8Array(readAttachment(a)), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${a.name.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff" } });
}
