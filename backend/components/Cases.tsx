"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Clock, History } from "lucide-react";
import type { Case } from "@/lib/cases";
import type { AlertRow } from "@/lib/alerts";
import type { Hit } from "@/lib/intel";
import { ago, idr } from "@/lib/format";
import { usePager } from "./Pager";
import { Skel, SkelCards, SkelTable } from "./Skeleton";
import NotesPanel from "./NotesPanel";
import Sla from "./Sla";

const STATUS_CLS: Record<Case["status"], string> = { OPEN: "MEDIUM", IN_PROGRESS: "", ESCALATED: "HIGH", CLOSED: "LOW" };
const label = (s: string) => s[0] + s.slice(1).toLowerCase().replace("_", " ");
type Row = Omit<Case, "events"> & { events: number };

export function CaseList() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null), [status, setStatus] = useState("open");
  useEffect(() => { fetch("/api/cases").then((r) => r.json()).then(setRows); }, []);
  const shown = (rows ?? []).filter((c) => (status === "open" ? c.status !== "CLOSED" : !status || c.status === status));
  const pager = usePager(shown);
  const n = (f: (c: Row) => boolean) => (rows ?? []).filter(f).length;
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Cases</h1><span className="mute">Investigations that group related alerts, with notes, files, assignee and SLA. Create a case from the Alerts queue (tick alerts) or from an alert page.</span></div>
        <Link className="btn" href="/alerts" style={{ marginLeft: "auto" }}>Pick alerts →</Link></div>
      {!rows ? <SkelCards n={4} /> : <div className="kpis">
        <div className="card kpi"><span className="ico"><Briefcase size={18} /></span><span className="mute">Open cases</span><b>{n((c) => c.status !== "CLOSED")}</b></div>
        <div className="card kpi"><span className="ico" style={{ color: "var(--high)", background: "color-mix(in srgb, var(--high) 12%, transparent)" }}><Clock size={18} /></span><span className="mute">Escalated (SLA breached)</span><b className="HIGH">{n((c) => c.status === "ESCALATED")}</b></div>
        <div className="card kpi"><span className="ico bt"><History size={18} /></span><span className="mute">In progress</span><b>{n((c) => c.status === "IN_PROGRESS")}</b></div>
        <div className="card kpi"><span className="ico teal"><Briefcase size={18} /></span><span className="mute">Closed</span><b>{n((c) => c.status === "CLOSED")}</b></div>
      </div>}
      <div className="filters">
        <select value={status} onChange={(e) => { setStatus(e.target.value); pager.reset(); }} aria-label="Status"><option value="open">All open</option><option value="">All</option>{["OPEN", "IN_PROGRESS", "ESCALATED", "CLOSED"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      {!rows ? <SkelTable cols={7} /> : <div className="card tablewrap"><table>
        <thead><tr><th>Case</th><th>Status</th><th>Priority</th><th>Alerts</th><th>Assignee</th><th>SLA</th><th>Updated</th></tr></thead>
        <tbody>
          {pager.shown.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => router.push(`/cases/${c.id}`)}>
              <td><b>{c.id}</b><div className="mute">{c.title}</div></td>
              <td><span className={`chip ${STATUS_CLS[c.status]}`}>{label(c.status)}</span></td>
              <td><span className={`chip ${c.priority}`}>{label(c.priority)}</span></td>
              <td>{c.alertIds.length}</td><td>{c.assignee || <span className="mute">Unassigned</span>}</td>
              <td>{c.status === "CLOSED" ? <span className="mute">Closed {ago(c.closedAt!)}</span> : <Sla due={c.slaDueAt} start={c.createdAt} />}</td>
              <td className="mute">{ago(c.updatedAt)}</td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={7} className="mute empty">No cases. Tick alerts in the Alerts queue and choose Create case.</td></tr>}
        </tbody>
      </table></div>}
      {pager.bar}
    </>
  );
}

type Detail = Case & { alerts: (AlertRow & { hits: Hit[] })[] };
export function CaseDetail({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [c, setC] = useState<Detail | null>(null), [err, setErr] = useState(""), [users, setUsers] = useState<{ username: string; name: string }[]>([]);
  const [closing, setClosing] = useState(false), [resolution, setResolution] = useState("");
  const load = () => fetch(`/api/cases/${id}`).then(async (r) => (r.ok ? setC(await r.json()) : setErr((await r.json()).error)));
  useEffect(() => { load(); fetch("/api/users").then((r) => r.json()).then((u) => Array.isArray(u) && setUsers(u)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function put(b: object) { const r = await fetch(`/api/cases/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); if (r.ok) { setClosing(false); load(); } }
  if (err) return <div className="card empty-state"><b>{err}</b><Link className="btn" href="/cases">Back to cases</Link></div>;
  if (!c) return <div style={{ display: "grid", gap: 16 }}><Skel w={300} h={26} /><SkelCards n={3} /><SkelTable rows={3} cols={5} /></div>;
  const ro = !canEdit, total = c.alerts.reduce((n, a) => n + a.amount, 0);
  return (
    <>
      <p><Link href="/cases">← Cases</Link></p>
      <div className="card alert-head">
        <div><span className="mute">Case</span><h1 style={{ margin: 0 }}>{c.id}</h1></div>
        <div style={{ flex: 1, minWidth: 220 }}><span className="mute">Title</span>{ro ? <b>{c.title}</b> : <input defaultValue={c.title} onBlur={(e) => e.target.value.trim() !== c.title && put({ title: e.target.value })} aria-label="Title" style={{ width: "100%" }} />}</div>
        <div><span className="mute">Status</span>{ro ? <span className={`chip ${STATUS_CLS[c.status]}`}>{label(c.status)}</span>
          : <select value={c.status} onChange={(e) => (e.target.value === "CLOSED" ? setClosing(true) : put({ status: e.target.value }))}>{["OPEN", "IN_PROGRESS", "ESCALATED", "CLOSED"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>}</div>
        <div><span className="mute">Priority</span>{ro ? <span className={`chip ${c.priority}`}>{label(c.priority)}</span>
          : <select value={c.priority} onChange={(e) => put({ priority: e.target.value })}>{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>}</div>
        <div><span className="mute">Assignee</span>{ro ? <b>{c.assignee}</b> : <select value={c.assignee} onChange={(e) => put({ assignee: e.target.value })}>{users.map((u) => <option key={u.username} value={u.username}>{u.name}</option>)}</select>}</div>
        <div><span className="mute">SLA</span>{c.status === "CLOSED" ? <b>Closed</b> : <Sla due={c.slaDueAt} start={c.createdAt} />}</div>
        <div><span className="mute">Exposure</span><b>{idr(total)}</b></div>
      </div>
      {closing && <div className="card" style={{ marginBottom: 16, display: "grid", gap: 8 }}>
        <b>Close case</b><textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Resolution: outcome, funds recovered, follow-ups (required)" />
        <span style={{ display: "flex", gap: 8 }}><button className="btn" disabled={!resolution.trim()} onClick={() => put({ status: "CLOSED", resolution })}>Close case</button><button onClick={() => setClosing(false)}>Cancel</button></span>
      </div>}
      {c.resolution && <p className="ok-msg"><b>Resolution:</b> {c.resolution}</p>}

      <h2>Alerts in this case ({c.alerts.length})</h2>
      <div className="card tablewrap" style={{ marginBottom: 16 }}><table>
        <thead><tr><th>Alert</th><th>Customer</th><th className="num">Amount</th><th>Beneficiary</th><th>Risk</th><th>Status</th><th>Hits</th></tr></thead>
        <tbody>{c.alerts.map((a) => (
          <tr key={a.id}><td><Link href={`/alerts/${a.id}`}><b>{a.id}</b></Link><div className="mute">{ago(a.createdAt)}</div></td><td>{a.customerName} <span className="mute">{a.maskedAccount}</span></td>
            <td className="num">{idr(a.amount)}</td><td>{a.beneficiary.masked}{a.beneficiary.isNew && <span className="chip NEW">NEW</span>}</td>
            <td><span className={`chip ${a.aiLevel ?? a.baselineLevel}`}>{a.aiLevel ?? a.baselineLevel}</span></td><td><span className={`status ${a.status}`}>{a.status}</span></td>
            <td>{a.hits.filter((h) => h.kind === "BLACKLIST" || h.kind === "AML").map((h, i) => <span key={i} className="chip HIGH" title={h.detail}>{h.kind}</span>)}</td></tr>
        ))}</tbody>
      </table></div>

      <NotesPanel entity={`case:${c.id}`} canEdit={!ro} />
      <h2>Timeline</h2>
      <div className="card"><ol className="dbg-log">{[...c.events].reverse().map((e, i) => <li key={i} className="ok" style={{ cursor: "default" }}><span>{e.text}</span><span className="mute">{e.by} · {ago(e.at)}</span></li>)}</ol></div>
    </>
  );
}
