"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string; note?: string };
const SUGGEST = ["Summarise today", "Show the latest alerts", "How many high-risk alerts are open?", "What is the false positive rate?", "Which rules are active?"];

// Floating, interactive AI chat on the Command Center. Read-only: answers from live console data.
export default function AssistantPopup() {
  const [open, setOpen] = useState(false), [msgs, setMsgs] = useState<Msg[]>([]), [text, setText] = useState(""), [busy, setBusy] = useState(false), [src, setSrc] = useState("");
  const end = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length, busy, open]);
  useEffect(() => { if (open) input.current?.focus(); const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [open]);
  async function send(t = text) {
    const content = t.trim(); if (!content || busy) return;
    const h = [...msgs, { role: "user" as const, content }]; setMsgs(h); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/copilot/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: h.map(({ role, content }) => ({ role, content })) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setSrc(j.source); setMsgs((m) => [...m, { role: "assistant", content: j.reply, note: j.note }]);
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: `Sorry, something went wrong: ${(e as Error).message}` }]); }
    setBusy(false);
  }
  return (
    <>
      {!open && <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Open AI assistant"><Sparkles size={20} /><span>Ask AI</span></button>}
      {open && (
        <div className="ai-pop card" role="dialog" aria-label="AI assistant">
          <div className="ai-pop-head"><span className="wf-ico"><Bot size={16} /></span><div><b>FraudSight AI</b><div className="mute">{src === "gemini" ? "Gemini · live console data" : src === "offline" ? "Offline answers (Gemini not configured)" : "Ask about alerts, fraud, rules, workflows"}</div></div>
            <button className="icon" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button></div>
          <div className="cp-log ai-log">
            {!msgs.length && <div className="mute cp-hello">Hi! I can answer questions about today&apos;s fraud activity using the live data on this console.<div className="wf-ex" style={{ marginTop: 8 }}>{SUGGEST.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div></div>}
            {msgs.map((m, i) => <div key={i} className={`cp-msg ${m.role}`}><div className="cp-bubble">{m.content}</div>{m.note && <small className="mute">{m.note}</small>}</div>)}
            {busy && <div className="cp-msg assistant"><div className="cp-bubble typing"><i /><i /><i /></div></div>}
            <div ref={end} />
          </div>
          <div className="cp-input">
            <textarea ref={input} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything about the data…" aria-label="Message"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn icon-send" onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send"><Send size={16} /></button>
          </div>
        </div>
      )}
    </>
  );
}
