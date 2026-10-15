import { subscribe } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const enc = new TextEncoder();
  let off = () => {}, beat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(ctl) {
      const send = (s: string) => { try { ctl.enqueue(enc.encode(s)); } catch { /* client gone */ } };
      send(": connected\n\n");
      off = subscribe((e) => send(`event: ${e.type}\ndata: ${JSON.stringify(e.row)}\n\n`));
      beat = setInterval(() => send(": hb\n\n"), 15000);
      req.signal.addEventListener("abort", () => { off(); clearInterval(beat); ctl.close(); });
    },
    cancel() { off(); clearInterval(beat); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
