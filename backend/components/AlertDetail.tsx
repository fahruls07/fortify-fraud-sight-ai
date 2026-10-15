"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Bot, Briefcase, History, MessageSquare, Network, User } from "lucide-react";
import NotesPanel from "./NotesPanel";
import Sla from "./Sla";
import type { Alert, AuditEvent, InvestigationReport, Transaction } from "@/lib/types";
import { heldFor, idr } from "@/lib/format";
import Customer360 from "./Customer360";
import SessionSignals from "./SessionSignals";
import ActionBar from "./ActionBar";
import CopilotPanel from "./CopilotPanel";
import NetworkGraph from "./NetworkGraph";
import { Skel, SkelCards, SkelTable } from "./Skeleton";

type Detail = { alert: Alert; transaction: Transaction; customerId: string; investigationId: string | null };
const TABS = [
  { key: "overview", label: "Overview", icon: User },
  { key: "signals", label: "Session signals", icon: Activity },
  { key: "copilot", label: "AI Assistant", icon: Bot },
  { key: "network", label: "Network", icon: Network },
  { key: "notes", label: "Notes & files", icon: MessageSquare },
  { key: "history", label: "History", icon: History },
] as const;
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" }) + " WIB";

// Investigation workspace: tabs on the left, the decision panel always visible on the right.
export default function AlertDetail({ id, canCase }: { id: string; canCase: boolean }) {
  const [users, setUsers] = useState<{ username: string; name: string }[]>([]);
  useEffect(() => { fetch("/api/users").then((r) => r.json()).then((u) => Array.isArray(u) && setUsers(u)); }, []);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("overview");
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [netSeen, setNetSeen] = useState(false); // React Flow needs a visible container to size itself, so mount it on first open
  useEffect(() => { if (tab === "network") setNetSeen(true); }, [tab]);

  useEffect(() => {
    fetch(`/api/alerts/${id}`).then(async (r) => (r.ok ? setD(await r.json()) : setErr((await r.json()).error)));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => { if (tab === "history") fetch(`/api/audit?entityId=${id}`).then((r) => r.json()).then(setAudit); }, [tab, id, d?.alert.status]);

  if (err) return <p className="auth-err">{err}</p>;
  if (!d) return <div style={{ display: "grid", gap: 16 }}><Skel w={260} h={26} /><SkelCards n={3} /><SkelTable rows={4} cols={4} /></div>;
  const { alert: a, transaction: tx } = d;
  const b = tx.beneficiary;
  return (
    <>
      <div className="card alert-head">
        <div>
          <span className="mute">Alert</span>
          <h1 style={{ margin: 0 }}>{a.id}</h1>
        </div>
        <div><span className="mute">Amount</span><b className="big">{idr(tx.amount)}</b></div>
        <div><span className="mute">Baseline risk</span><span className={`chip ${a.baselineLevel}`}>{a.baselineLevel[0] + a.baselineLevel.slice(1).toLowerCase()} · {a.baselineScore}</span></div>
        {report && <div><span className="mute">AI risk</span><span className={`chip ${report.riskLevel}`}>{report.riskLevel}</span></div>}
        <div><span className="mute">Status</span><span className={`status ${a.status}`}>{a.status} · tx {tx.status}</span></div>
        <div><span className="mute">{a.status === "Decided" ? "Created" : "Held for"}</span><b>{a.status === "Decided" ? dt(a.createdAt) : heldFor(a.createdAt, now)}</b></div>
        <div><span className="mute">Assigned to</span>{canCase && a.status !== "Decided"
          ? <select value={a.assignedTo} onChange={async (e) => { const r = await fetch(`/api/alerts/${a.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignee: e.target.value }) }); if (r.ok) setD({ ...d, alert: await r.json() }); }} aria-label="Assign alert">
              <option value="">Unassigned</option>{users.map((u) => <option key={u.username} value={u.username}>{u.name} (@{u.username})</option>)}</select>
          : <b>{a.assignedTo || "Unassigned"}</b>}</div>
        <div><span className="mute">SLA</span><Sla due={a.slaDueAt} start={a.createdAt} done={a.status === "Decided"} />{a.status === "Decided" && <b>Met</b>}</div>
        <div><span className="mute">Case</span>{a.caseId ? <Link href={`/cases/${a.caseId}`} className="ico-btn button"><Briefcase size={14} /> {a.caseId}</Link>
          : canCase ? <button className="ico-btn" onClick={async () => { const r = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertIds: [a.id] }) }); if (r.ok) setD({ ...d, alert: { ...a, caseId: (await r.json()).id } }); }}><Briefcase size={14} /> Open case</button> : <b>—</b>}</div>
      </div>

      <div className="investigate">
        <div>
          <div className="auth-tabs tabs-ico" role="tablist" style={{ marginBottom: 16 }}>
            {TABS.map(({ key, label, icon: Icon }) => (key !== "signals" || tx.sessionId) && (
              <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}><Icon size={15} /> {label}{key === "copilot" && report && <span className={`dot ${report.riskLevel === "LOW" ? "ok" : "bad"}`} />}</button>
            ))}
          </div>
          {/* Panels stay mounted (hidden) so the Assistant stream and its report keep running while you switch tabs. */}
          <div hidden={tab !== "overview"} className="stack">
            {!!a.hits?.length && <div className="card"><b>Watchlist, AML &amp; threshold hits</b><div className="hits" style={{ marginTop: 8 }}>
              {a.hits.map((h, i) => <div key={i} className={`hit ${h.kind}`}><span className={`chip ${h.kind === "WHITELIST" ? "LOW" : h.kind === "AML" || h.kind === "THRESHOLD" ? "MEDIUM" : "HIGH"}`}>{h.kind}</span><span><b>{h.type}</b> {h.value}<div className="mute">{h.detail}</div></span></div>)}
            </div></div>}
            <div className="card">
              <b>Transaction</b>
              <dl className="kv">
                <dt>Transaction ID</dt><dd>{tx.id}</dd>
                <dt>Customer</dt><dd><Link href={`/customers/${d.customerId}`}>{d.customerId} · open profile</Link></dd>
                {tx.sessionId && <><dt>Session</dt><dd><Link href={`/sessions/${tx.sessionId}`}>{tx.sessionId} · device & biometrics</Link></dd></>}
                <dt>Channel</dt><dd>{tx.channel}</dd>
                <dt>Created</dt><dd>{dt(tx.createdAt)}</dd>
                <dt>Beneficiary</dt><dd>{b.name} · {b.bankName}</dd>
                <dt>Account</dt><dd>{b.accountId}{b.isNew && <span className="chip NEW">NEW</span>}</dd>
                <dt>Account age</dt><dd>{b.accountAgeDays} days</dd>
              </dl>
            </div>
            <Customer360 key={`${a.status}${tx.status}`} customerId={d.customerId} />
          </div>
          {tx.sessionId && <div hidden={tab !== "signals"}><SessionSignals sessionId={tx.sessionId} /></div>}
          <div hidden={tab !== "copilot"}><CopilotPanel alertId={a.id} investigationId={d.investigationId} onReport={setReport} baseline={{ score: a.baselineScore, level: a.baselineLevel }} /></div>
          <div hidden={tab !== "network"}>{netSeen && <NetworkGraph accountId={b.accountId} expand={!!report?.reasonCodes.some((r) => r.code === "RC_MULE_NETWORK")} />}</div>
          {tab === "notes" && <NotesPanel entity={`alert:${a.id}`} canEdit={canCase} />}
          <div hidden={tab !== "history"}>
            {!audit ? <SkelTable rows={3} cols={4} /> : (
              <div className="card tablewrap"><table>
                <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Reason</th></tr></thead>
                <tbody>
                  {audit.map((e) => <tr key={e.id}><td className="mute">{dt(e.at)}</td><td>{e.actor}</td><td><code>{e.action}</code></td><td className="mute">{e.reason ?? "—"}</td></tr>)}
                  {!audit.length && <tr><td colSpan={4} className="mute empty">No actions taken on this alert yet.</td></tr>}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
        <ActionBar alert={a} tx={tx} recommended={report?.recommendedAction} onDone={(r) => setD({ ...d, alert: r.alert, transaction: r.transaction })} />
      </div>
    </>
  );
}
