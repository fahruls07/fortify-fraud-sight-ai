"use client";
import { useRef, useState } from "react";
import { CheckCircle2, Lock, MessageSquareWarning, Sparkles, XCircle } from "lucide-react";
import type { Alert, Transaction } from "@/lib/types";
import { idr } from "@/lib/format";

type Result = { alert: Alert; transaction: Transaction; accountStatus: string };
const ACTIONS = [
  { action: "APPROVE", label: "Approve & release", hint: "Not fraud. Release the held funds.", ai: "ALLOW", fraud: "NOT_FRAUD", icon: CheckCircle2, cls: "ok" },
  { action: "CHALLENGE", label: "Challenge customer", hint: "Ask the customer to confirm the transfer.", ai: "CHALLENGE", fraud: null, icon: MessageSquareWarning, cls: "warn" },
  { action: "DECLINE", label: "Decline", hint: "Fraud. Cancel this transfer.", ai: "DECLINE", fraud: "FRAUD", icon: XCircle, cls: "bad" },
  { action: "DECLINE_AND_FREEZE", label: "Decline & freeze account", hint: "Fraud. Cancel and lock the account.", ai: "DECLINE_AND_FREEZE", fraud: "FRAUD", icon: Lock, cls: "bad solid" },
] as const;

// Decision panel. `recommended` is the Assistant recommendedAction: that button is highlighted, and choosing anything else requires a reason.
export default function ActionBar({ alert, tx, recommended, onDone }: { alert: Alert; tx: Transaction; recommended?: string; onDone: (r: Result) => void }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const decided = alert.status === "Decided";

  async function send(a: (typeof ACTIONS)[number]) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/alerts/${alert.id}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: a.action, label: a.fraud ?? undefined, reason: reason || undefined }),
    });
    const j = await res.json();
    setBusy(false); dlg.current?.close();
    if (!res.ok) return setMsg({ ok: false, text: j.error });
    setReason("");
    setMsg({ ok: true, text: a.action === "APPROVE" ? "Transaction released." : a.action === "CHALLENGE" ? "Challenge sent to customer." : `${idr(tx.amount)} saved.` });
    onDone(j);
  }
  const freeze = ACTIONS[3];
  const overriding = (a: (typeof ACTIONS)[number]) => !!recommended && a.ai !== recommended;
  const needReason = !!recommended && !reason.trim();

  return (
    <aside className="card decide" aria-label="Decision">
      <div className="hdr" style={{ margin: 0 }}><b>Decision</b>{!decided && <span className="chip MEDIUM" style={{ marginLeft: "auto" }}>Action required</span>}</div>
      {decided ? <p style={{ margin: 0 }}>This alert is decided. Transaction status: <b>{tx.status}</b>.</p> : <>
        {recommended
          ? <p className="ai-rec"><Sparkles size={15} /> Assistant recommends <b>{recommended.replaceAll("_", " ").toLowerCase()}</b>. A reason is required to choose a different action.</p>
          : <p className="mute" style={{ margin: 0 }}>Run the AI Assistant for a recommendation, or decide based on your own review.</p>}
        <label className="field"><span>Reason {recommended ? <span className="mute">(required to override AI)</span> : <span className="mute">(optional)</span>}</span>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did you verify? e.g. called customer, confirmed screen-sharing scam" aria-invalid={needReason && undefined} />
        </label>
        <div className="decide-btns">
          {ACTIONS.map((a) => {
            const Icon = a.icon, rec = recommended === a.ai, blocked = overriding(a) && !reason.trim();
            return (
              <button key={a.action} className={`act-btn ${a.cls}${rec ? " rec" : ""}`} disabled={busy || blocked} title={blocked ? "Enter a reason to override the AI recommendation" : a.hint}
                onClick={() => (a === freeze ? dlg.current?.showModal() : send(a))}>
                <Icon size={18} /><span><b>{a.label}{rec && " · AI pick"}</b><small>{a.hint}</small></span>
              </button>
            );
          })}
        </div>
      </>}
      {msg && <p className={msg.ok ? "ok-msg" : "auth-err"} role="status" style={{ margin: 0 }}>{msg.text}</p>}
      <dialog ref={dlg}>
        <p>Decline {idr(tx.amount)} and freeze the customer&apos;s account?<br /><span className="mute">Funds saved: {idr(tx.amount)}</span></p>
        <button onClick={() => dlg.current?.close()}>Cancel</button> <button className="btn" disabled={busy} onClick={() => send(freeze)}>Decline &amp; freeze</button>
      </dialog>
    </aside>
  );
}
