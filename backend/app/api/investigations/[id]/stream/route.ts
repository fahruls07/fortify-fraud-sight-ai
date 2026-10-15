import { subscribeInvestigation } from "@/lib/copilot/orchestrator";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Replays past steps, then streams live. Events: step, result, failed ("failed" because "error" is EventSource's own event).
// Replay and subscribe happen in one synchronous block, so no event can fall between them.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const inv = getStore().investigations[(await params).id];
  if (!inv) return Response.json({ error: "investigation not found" }, { status: 404 });
  const enc = new TextEncoder();
  let off = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      const send = (type: string, data: unknown) => { try { ctl.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* client gone */ } };
      const end = () => { off(); try { ctl.close(); } catch { /* already closed */ } };
      for (const ev of inv.events) send("step", ev);
      if (inv.status === "done") { send("result", { report: inv.report, fallback: inv.fallback }); return end(); }
      if (inv.status === "failed") { send("failed", { error: inv.error }); return end(); }
      off = subscribeInvestigation(inv.id, (e) => { send(e.type, e.data); if (e.type !== "step") end(); });
      req.signal.addEventListener("abort", end);
    },
    cancel() { off(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
