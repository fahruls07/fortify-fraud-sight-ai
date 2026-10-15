"use client";
import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Send, Sparkles } from "lucide-react";

type Kind = "rule" | "workflow";
type Proposal = Record<string, unknown>;
type Msg = { role: "user" | "assistant"; content: string; proposal?: Proposal | null; note?: string; source?: string; applied?: boolean; prev?: unknown };
const EXAMPLES: Record<Kind, string[]> = {
  rule: ["Block transfers over 10 juta while a screen-sharing app is active", "Hold transfers to a new beneficiary between 1-5 am", "Also require VPN"],
  workflow: ["When a transfer is over 20 juta from a new device, ask AI and if risky block it and notify the customer", "Score amount, VPN and new beneficiary; flag medium, block high", "Call RULE-0001 and send an alert to SOC if it matches"],
};

// Chat with the Builder Assistant. With "Apply on the fly" each valid proposal replaces what is on screen (unsaved) and can be undone.
export default function CopilotChat({ kind, getCurrent, onApply, disabled, summary }: {
  kind: Kind; getCurrent: () => unknown; onApply: (p: Proposal | unknown) => void; disabled?: boolean; summary: (p: Proposal) => string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]), [text, setText] = useState(""), [busy, setBusy] = useState(false), [auto, setAuto] = useState(true), [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length, busy]);

  const apply = (i: number) => setMsgs((ms) => ms.map((m, j) => { if (j !== i || !m.proposal) return m; const prev = getCurrent(); onApply(m.proposal); return { ...m, applied: true, prev }; }));
  const undo = (i: number) => setMsgs((ms) => ms.map((m, j) => { if (j !== i) return m; onApply(m.prev); return { ...m, applied: false }; }));
  async function send(t = text) {
    const content = t.trim(); if (!content || busy) return;
    const history = [...msgs, { role: "user" as const, content }];
    setMsgs(history); setText(""); setBusy(true); setErr("");
    try {
      const r = await fetch("/api/copilot/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, current: getCurrent(), messages: history.map(({ role, content }) => ({ role, content })) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const m: Msg = { role: "assistant", content: j.reply, proposal: j.proposal, note: j.note, source: j.source };
      if (auto && j.proposal) { m.prev = getCurrent(); onApply(j.proposal); m.applied = true; }
      setMsgs((ms) => [...ms, m]);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="copilot">
      <div className="hdr" style={{ margin: 0 }}><Sparkles size={16} className="wf-ai-ico" /><b>{kind === "rule" ? "Rule" : "Workflow"} Assistant</b>
        <label className="toggle" style={{ marginLeft: "auto", fontSize: 12 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Apply on the fly</label></div>
      <div className="cp-log" aria-live="polite">
        {!msgs.length && <div className="mute cp-hello">Describe the {kind} you want, or ask me to change the current one. I build it {auto ? "and apply it right away" : "and you click Apply"}; nothing is saved until you press Save.
          <div className="wf-ex" style={{ marginTop: 8 }}>{EXAMPLES[kind].map((x) => <button key={x} onClick={() => send(x)} disabled={disabled || busy}>{x}</button>)}</div></div>}
        {msgs.map((m, i) => (
          <div key={i} className={`cp-msg ${m.role}`}>
            <div className="cp-bubble">{m.content}</div>
            {m.proposal && <div className="cp-prop">
              <span className="mute">{summary(m.proposal)}</span>
              {m.applied ? <><span className="chip LOW"><Check size={12} /> applied</span>{m.prev !== undefined && <button className="linkish" onClick={() => undo(i)}><RotateCcw size={12} /> Undo</button>}</>
                : <button className="btn" style={{ padding: "3px 10px" }} disabled={disabled} onClick={() => apply(i)}>Apply</button>}
            </div>}
            {m.note && <small className="mute">{m.note}</small>}
          </div>
        ))}
        {busy && <div className="cp-msg assistant"><div className="cp-bubble typing"><i /><i /><i /></div></div>}
        <div ref={end} />
      </div>
      {err && <p className="auth-err" style={{ margin: 0 }}>{err}</p>}
      <div className="cp-input">
        <textarea rows={2} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} placeholder={disabled ? "Read-only" : "e.g. add a VPN check and notify the customer"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Message the Assistant" />
        <button className="btn icon-send" onClick={() => send()} disabled={disabled || busy || !text.trim()} aria-label="Send"><Send size={16} /></button>
      </div>
    </div>
  );
}
